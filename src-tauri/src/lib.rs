//! Prism — desktop shell.
//!
//! Rust owns storage, file-watching and native macOS chrome. All task logic
//! lives in the TypeScript layer, which reads and writes the vault as one JSON
//! document. That keeps a single source of truth and avoids reimplementing the
//! same rules in two languages.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::new_debouncer;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

const APP_ID: &str = "com.shawon.prism";

/// Tracks the `meta.updatedAt` value of our own most recent write, so the file
/// watcher can tell an external edit (Claude, the CLI, MEGA sync) apart from
/// the echo of a save we just performed.
#[derive(Default)]
struct AppState {
    last_self_write: Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
struct VaultPayload {
    contents: String,
    path: String,
}

// ── Path resolution (mirrors bin/vault.mjs) ──────────────────────────────────

fn app_support_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Library/Application Support")
        .join(APP_ID)
}

/// Resolution order: $PRISM_DATA_DIR → config.json `dataDir` → app-support default.
fn resolve_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PRISM_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }

    let config = app_support_dir().join("config.json");
    if let Ok(text) = fs::read_to_string(&config) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(dir) = json.get("dataDir").and_then(|v| v.as_str()) {
                if !dir.trim().is_empty() {
                    return PathBuf::from(dir);
                }
            }
        }
    }

    // Installed-app fallback: keep data beside the config rather than guessing
    // at a repo checkout that may not exist on this machine.
    app_support_dir().join("data")
}

fn vault_file() -> PathBuf {
    resolve_data_dir().join("tasks.json")
}

fn empty_vault_json() -> String {
    let now = iso_now();
    serde_json::json!({
        "version": 1,
        "tasks": [],
        "projects": [],
        "digests": [],
        "meta": { "createdAt": now, "updatedAt": now, "lastSeq": 0 }
    })
    .to_string()
}

/// RFC3339 timestamp with millisecond precision, matching `Date#toISOString`.
fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();

    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mth <= 2 { y + 1 } else { y };

    format!("{year:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

fn read_updated_at(contents: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(contents)
        .ok()?
        .get("meta")?
        .get("updatedAt")?
        .as_str()
        .map(str::to_owned)
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn read_vault() -> Result<VaultPayload, String> {
    let path = vault_file();
    if !path.exists() {
        let seed = empty_vault_json();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, &seed).map_err(|e| e.to_string())?;
        return Ok(VaultPayload { contents: seed, path: path.display().to_string() });
    }

    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(VaultPayload { contents, path: path.display().to_string() })
}

/// Atomically persist the vault.
///
/// `expected_updated_at` implements optimistic concurrency: if the on-disk
/// document moved on since the caller last read it, the write is refused so the
/// frontend can reload and re-apply rather than clobbering a CLI edit.
#[tauri::command]
fn write_vault(
    contents: String,
    expected_updated_at: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Refuse to persist anything that is not valid JSON — a corrupt vault is
    // far more painful than a rejected save.
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("refusing to write invalid JSON: {e}"))?;

    let path = vault_file();
    if let Some(expected) = expected_updated_at {
        if let Ok(current) = fs::read_to_string(&path) {
            if let Some(on_disk) = read_updated_at(&current) {
                if on_disk != expected {
                    return Err("conflict".into());
                }
            }
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if let Some(stamp) = read_updated_at(&contents) {
        *state.last_self_write.lock().unwrap() = Some(stamp);
    }

    // Write-then-rename: readers never observe a partial document.
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&tmp, &contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn vault_location() -> String {
    vault_file().display().to_string()
}

#[tauri::command]
fn reveal_vault(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = vault_file();
    let target = if path.exists() { path } else { resolve_data_dir() };
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|e| e.to_string())
}

/// Mirror the open-task count into the menu bar so the number is visible
/// without bringing the window forward.
#[tauri::command]
fn set_tray_badge(app: AppHandle, count: u32, urgent: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("prism-tray") {
        let title = match (count, urgent) {
            (0, _) => String::new(),
            (n, true) => format!("{n} !"),
            (n, false) => n.to_string(),
        };
        tray.set_title(Some(title)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    focus_main(&app);
}

// ── Window helpers ───────────────────────────────────────────────────────────

fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
            let _ = win.hide();
        } else {
            focus_main(app);
        }
    }
}

// ── File watching ────────────────────────────────────────────────────────────

/// Watch the vault's directory and notify the frontend when someone else edits
/// it. Directories are watched rather than the file itself because atomic
/// rename replaces the inode, which breaks a file-level watch after one save.
fn spawn_vault_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let dir = resolve_data_dir();
        if fs::create_dir_all(&dir).is_err() {
            return;
        }

        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(120), None, tx) {
            Ok(d) => d,
            Err(err) => {
                eprintln!("prism: could not start vault watcher: {err}");
                return;
            }
        };

        if let Err(err) = debouncer.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("prism: could not watch {}: {err}", dir.display());
            return;
        }

        let target = vault_file();
        for events in rx {
            let Ok(events) = events else { continue };
            let touched = events
                .iter()
                .any(|e| e.paths.iter().any(|p| p == &target));
            if !touched {
                continue;
            }

            let Ok(contents) = fs::read_to_string(&target) else { continue };

            // Skip the echo of our own save.
            let stamp = read_updated_at(&contents);
            {
                let state = app.state::<AppState>();
                let mut last = state.last_self_write.lock().unwrap();
                if stamp.is_some() && *last == stamp {
                    *last = None;
                    continue;
                }
            }

            let _ = app.emit(
                "vault-changed",
                VaultPayload { contents, path: target.display().to_string() },
            );
        }
    });
}

// ── App setup ────────────────────────────────────────────────────────────────

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Prism", true, Some("Cmd+Shift+K"))?;
    let reveal = MenuItem::with_id(app, "reveal", "Reveal Vault in Finder…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Prism", true, Some("Cmd+Q"))?;
    let menu = Menu::with_items(app, &[&open, &reveal, &sep, &quit])?;

    // A dedicated monochrome glyph — using the colourful app icon as a template
    // would flatten it into a solid black square.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("prism-tray")
        .icon(tray_icon)
        .icon_as_template(true) // adopts the menu bar's light/dark treatment
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main(app),
            "reveal" => {
                let _ = reveal_vault(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(&tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                focus_main(app);
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            read_vault,
            write_vault,
            vault_location,
            reveal_vault,
            set_tray_badge,
            show_main_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            if let Some(window) = app.get_webview_window("main") {
                // Real NSVisualEffectView behind the webview. Everything the
                // CSS layer draws sits on top of genuine system material.
                #[cfg(target_os = "macos")]
                {
                    if apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::UnderWindowBackground,
                        Some(NSVisualEffectState::Active),
                        None,
                    )
                    .is_err()
                    {
                        // Older macOS: fall back to a material that always exists.
                        let _ = apply_vibrancy(
                            &window,
                            NSVisualEffectMaterial::HudWindow,
                            Some(NSVisualEffectState::Active),
                            None,
                        );
                    }
                }

                // Closing the window parks the app in the menu bar instead of
                // quitting — this is a background utility.
                let close_handle = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = close_handle.hide();
                    }
                });
            }

            build_tray(&handle)?;
            spawn_vault_watcher(handle.clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

                let hotkey = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyK);
                let registered = handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyK)
                            {
                                toggle_main(app);
                            }
                        })
                        .build(),
                );

                // A taken hotkey must not be fatal — the app is still usable.
                match registered {
                    Ok(()) => {
                        if let Err(err) = handle.global_shortcut().register(hotkey) {
                            eprintln!("prism: ⌘⇧K unavailable ({err}); use the menu bar icon");
                        }
                    }
                    Err(err) => eprintln!("prism: global shortcut plugin failed: {err}"),
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Prism");
}

#[cfg(desktop)]
use tauri_plugin_global_shortcut::GlobalShortcutExt;
