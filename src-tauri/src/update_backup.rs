use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use super::update_channel::{Channel, UpdateIntent};

pub const LAST_BACKUP_FILE: &str = "last-update-backup.json";

#[derive(Clone, Debug, Default)]
pub struct OwnerConfigSnapshots {
    pub lifecycle_json: Option<Vec<u8>>,
    pub reminders_json: Option<Vec<u8>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub backup_id: String,
    pub path: String,
    pub created_at: u64,
    pub from_version: String,
    pub to_version: String,
    pub channel: Channel,
    pub intent: UpdateIntent,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileEntry {
    pub category: String,
    pub relative_path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub backup_id: String,
    pub created_at: u64,
    pub from_version: String,
    pub to_version: String,
    pub channel: Channel,
    pub intent: UpdateIntent,
    pub data_root: String,
    pub config_dir: String,
    pub files: Vec<BackupFileEntry>,
}

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    let mut padded = Vec::with_capacity(((bytes.len() + 9 + 63) / 64) * 64);
    padded.extend_from_slice(bytes);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = String::with_capacity(64);
    for word in h {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{word:08x}");
    }
    out
}

fn sanitize_segment(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect()
}

fn ensure_journal_drained(data_root: &Path) -> Result<(), String> {
    let journal_dir = data_root.join(".journal");
    if !journal_dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(&journal_dir)
        .map_err(|error| format!("无法检查事务日志目录（.journal）：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取事务日志目录项失败：{error}"))?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if entry.path().is_file() {
            return Err(format!(
                "数据目录中存在未恢复的事务日志（.journal/{name_str}），为保护数据完整已中止安装；请重启软件完成恢复后再试"
            ));
        }
    }
    Ok(())
}

fn is_excluded_backup_target(path: &Path, exclude_backups_dir: &Path) -> bool {
    if path == exclude_backups_dir || path.starts_with(exclude_backups_dir) {
        return true;
    }
    if let (Ok(canon_path), Ok(canon_exclude)) = (fs::canonicalize(path), fs::canonicalize(exclude_backups_dir)) {
        if canon_path == canon_exclude || canon_path.starts_with(&canon_exclude) {
            return true;
        }
    }
    false
}

fn collect_files_recursively(
    base: &Path,
    current: &Path,
    exclude_backups_dir: &Path,
    is_config_root: bool,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(current)
        .map_err(|error| format!("无法读取目录 {}：{error}", current.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("遍历目录 {} 失败：{error}", current.display()))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if is_excluded_backup_target(&path, exclude_backups_dir) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}：{error}", path.display()))?;
        if file_type.is_dir() {
            if !is_config_root && current == base && name == ".journal" {
                // Top-level .journal in data_root is already verified empty by ensure_journal_drained.
                continue;
            }
            collect_files_recursively(base, &path, exclude_backups_dir, is_config_root, out)?;
        } else if file_type.is_file() {
            if is_config_root && (name.ends_with(".tmp") || name == "evidence.jsonl" || name == LAST_BACKUP_FILE) {
                continue;
            }
            out.push(path);
        }
    }
    Ok(())
}

fn write_snapshot_entry(
    dest_base: &Path,
    category: &str,
    relative_path: &str,
    bytes: &[u8],
    files: &mut Vec<BackupFileEntry>,
) -> Result<(), String> {
    let dest = dest_base.join(relative_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建备份子目录 {}：{error}", parent.display()))?;
    }
    let mut out_file = fs::File::create(&dest)
        .map_err(|error| format!("无法创建备份文件 {}：{error}", dest.display()))?;
    out_file
        .write_all(bytes)
        .and_then(|_| out_file.sync_all())
        .map_err(|error| format!("写入备份文件 {} 失败：{error}", dest.display()))?;
    files.push(BackupFileEntry {
        category: category.to_string(),
        relative_path: relative_path.to_string(),
        size: bytes.len() as u64,
        sha256: sha256_hex(bytes),
    });
    Ok(())
}

fn copy_and_record_category(
    source_base: &Path,
    dest_base: &Path,
    exclude_backups_dir: &Path,
    category: &str,
    is_config_root: bool,
    owner_snapshots: Option<&OwnerConfigSnapshots>,
    files: &mut Vec<BackupFileEntry>,
) -> Result<(), String> {
    if !source_base.exists() {
        return Ok(());
    }
    let mut paths = Vec::new();
    collect_files_recursively(source_base, source_base, exclude_backups_dir, is_config_root, &mut paths)?;
    for src in paths {
        let rel = src
            .strip_prefix(source_base)
            .map_err(|error| error.to_string())?;
        let rel_normalized = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        if is_config_root {
            if let Some(snaps) = owner_snapshots {
                if (rel_normalized == "lifecycle.json" && snaps.lifecycle_json.is_some())
                    || (rel_normalized == "reminders.json" && snaps.reminders_json.is_some())
                {
                    continue;
                }
            }
        }
        let dest = dest_base.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建备份子目录 {}：{error}", parent.display()))?;
        }
        let bytes = fs::read(&src)
            .map_err(|error| format!("无法读取待备份文件 {}：{error}", src.display()))?;
        let mut out_file = fs::File::create(&dest)
            .map_err(|error| format!("无法创建备份文件 {}：{error}", dest.display()))?;
        out_file
            .write_all(&bytes)
            .and_then(|_| out_file.sync_all())
            .map_err(|error| format!("写入备份文件 {} 失败：{error}", dest.display()))?;
        files.push(BackupFileEntry {
            category: category.to_string(),
            relative_path: rel_normalized,
            size: bytes.len() as u64,
            sha256: sha256_hex(&bytes),
        });
    }
    if is_config_root {
        if let Some(snaps) = owner_snapshots {
            if let Some(lifecycle_bytes) = &snaps.lifecycle_json {
                write_snapshot_entry(dest_base, category, "lifecycle.json", lifecycle_bytes, files)?;
            }
            if let Some(reminders_bytes) = &snaps.reminders_json {
                write_snapshot_entry(dest_base, category, "reminders.json", reminders_bytes, files)?;
            }
        }
    }
    files.sort_by(|a, b| (&a.category, &a.relative_path).cmp(&(&b.category, &b.relative_path)));
    Ok(())
}

pub fn verify_backup_dir(backup_dir: &Path) -> Result<BackupManifest, String> {
    let manifest_path = backup_dir.join("backup-manifest.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("无法读取备份清单 {}：{error}", manifest_path.display()))?;
    let manifest: BackupManifest = serde_json::from_str(&raw)
        .map_err(|error| format!("备份清单格式无效：{error}"))?;
    for entry in &manifest.files {
        let root = match entry.category.as_str() {
            "data" => backup_dir.join("data"),
            "config" => backup_dir.join("config"),
            "appData" => backup_dir.join("app-data"),
            other => return Err(format!("未知的备份文件分类：{other}")),
        };
        let target = entry.relative_path.split('/').fold(root, |acc, part| acc.join(part));
        let bytes = fs::read(&target)
            .map_err(|error| format!("备份校验失败，缺少文件 {}：{error}", entry.relative_path))?;
        if bytes.len() as u64 != entry.size {
            return Err(format!(
                "备份校验失败，文件大小不一致（{}：期望 {}，实际 {}）",
                entry.relative_path,
                entry.size,
                bytes.len()
            ));
        }
        let digest = sha256_hex(&bytes);
        if digest != entry.sha256 {
            return Err(format!("备份校验失败，文件哈希不一致（{}）", entry.relative_path));
        }
    }
    Ok(manifest)
}

fn allocate_unique_backup_dir(backups_root: &Path, base_id: &str) -> Result<(String, PathBuf), String> {
    let mut suffix = 1usize;
    loop {
        let id = if suffix == 1 {
            base_id.to_string()
        } else {
            format!("{base_id}-{suffix}")
        };
        let dir = backups_root.join(&id);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok((id, dir)),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                suffix += 1;
            }
            Err(error) => {
                return Err(format!("无法创建备份目录 {}：{error}", dir.display()));
            }
        }
    }
}

#[cfg(test)]
pub fn create_and_verify_backup_in_dirs(
    config_dir: &Path,
    app_data_dir: Option<&Path>,
    from_version: &str,
    to_version: &str,
    channel: Channel,
    intent: UpdateIntent,
    created_at: u64,
) -> Result<BackupInfo, String> {
    create_and_verify_backup_in_dirs_with_snapshots(
        config_dir,
        app_data_dir,
        from_version,
        to_version,
        channel,
        intent,
        created_at,
        None,
    )
}

pub fn create_and_verify_backup_in_dirs_with_snapshots(
    config_dir: &Path,
    app_data_dir: Option<&Path>,
    from_version: &str,
    to_version: &str,
    channel: Channel,
    intent: UpdateIntent,
    created_at: u64,
    owner_snapshots: Option<&OwnerConfigSnapshots>,
) -> Result<BackupInfo, String> {
    let config_path = config_dir.join("config.json");
    if !config_path.exists() {
        return Err("尚未配置数据目录（缺少 config.json），无法建立安装前数据备份".into());
    }
    let config_raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("无法读取配置文件 config.json：{error}"))?;
    let config_val: serde_json::Value = serde_json::from_str(&config_raw)
        .map_err(|error| format!("配置文件 config.json 已损坏：{error}"))?;
    let data_root_str = config_val
        .get("root")
        .and_then(|v| v.as_str())
        .ok_or("配置文件 config.json 缺少 root 数据目录字段")?;
    let data_root = PathBuf::from(data_root_str);
    if !data_root.is_absolute() || !data_root.is_dir() {
        return Err(format!("数据目录不存在或不是有效目录：{}", data_root.display()));
    }

    ensure_journal_drained(&data_root)?;

    let backups_root = config_dir.join("backups");
    fs::create_dir_all(&backups_root)
        .map_err(|error| format!("无法创建备份根目录 {}：{error}", backups_root.display()))?;
    let base_id = format!(
        "{created_at}-{}-to-{}",
        sanitize_segment(from_version),
        sanitize_segment(to_version)
    );
    let (backup_id, backup_dir) = allocate_unique_backup_dir(&backups_root, &base_id)?;
    if let Err(error) = fs::create_dir_all(backup_dir.join("data"))
        .and_then(|_| fs::create_dir_all(backup_dir.join("config")))
    {
        let _ = fs::remove_dir_all(&backup_dir);
        return Err(format!("无法初始化备份目录结构：{error}"));
    }

    let mut files = Vec::new();
    let copy_result = (|| -> Result<BackupInfo, String> {
        copy_and_record_category(
            &data_root,
            &backup_dir.join("data"),
            &backups_root,
            "data",
            false,
            None,
            &mut files,
        )?;
        copy_and_record_category(
            config_dir,
            &backup_dir.join("config"),
            &backups_root,
            "config",
            true,
            owner_snapshots,
            &mut files,
        )?;
        if let Some(extra_dir) = app_data_dir {
            if extra_dir != config_dir && extra_dir.exists() {
                fs::create_dir_all(backup_dir.join("app-data"))
                    .map_err(|error| format!("无法创建 app-data 备份目录：{error}"))?;
                copy_and_record_category(
                    extra_dir,
                    &backup_dir.join("app-data"),
                    &backups_root,
                    "appData",
                    true,
                    None,
                    &mut files,
                )?;
            }
        }

        let manifest = BackupManifest {
            backup_id: backup_id.clone(),
            created_at,
            from_version: from_version.to_string(),
            to_version: to_version.to_string(),
            channel,
            intent,
            data_root: data_root_str.to_string(),
            config_dir: config_dir.to_string_lossy().into_owned(),
            files,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| error.to_string())?;
        let manifest_path = backup_dir.join("backup-manifest.json");
        let mut manifest_file = fs::File::create(&manifest_path)
            .map_err(|error| format!("无法写入备份清单：{error}"))?;
        manifest_file
            .write_all(&manifest_bytes)
            .and_then(|_| manifest_file.sync_all())
            .map_err(|error| format!("无法同步备份清单：{error}"))?;
        drop(manifest_file);

        let verified = verify_backup_dir(&backup_dir)?;
        let total_bytes: u64 = verified.files.iter().map(|entry| entry.size).sum();
        let info = BackupInfo {
            backup_id,
            path: backup_dir.to_string_lossy().into_owned(),
            created_at,
            from_version: from_version.to_string(),
            to_version: to_version.to_string(),
            channel,
            intent,
            file_count: verified.files.len(),
            total_bytes,
        };
        let temp_last = config_dir.join("last-update-backup.tmp");
        let target_last = config_dir.join(LAST_BACKUP_FILE);
        let info_bytes = serde_json::to_vec_pretty(&info).map_err(|error| error.to_string())?;
        fs::write(&temp_last, info_bytes)
            .and_then(|_| fs::rename(&temp_last, &target_last))
            .map_err(|error| format!("无法记录最近一次更新备份元数据：{error}"))?;
        Ok(info)
    })();

    if copy_result.is_err() {
        let _ = fs::remove_dir_all(&backup_dir);
    }
    copy_result
}

pub fn read_last_backup_from_dir(config_dir: &Path) -> Option<BackupInfo> {
    let path = config_dir.join(LAST_BACKUP_FILE);
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn create_and_verify_backup(
    app: &tauri::AppHandle,
    from_version: &str,
    to_version: &str,
    channel: Channel,
    intent: UpdateIntent,
    owner_snapshots: &OwnerConfigSnapshots,
) -> Result<BackupInfo, String> {
    let config_dir = super::config_dir(app)?;
    let app_data_dir = app.path().app_data_dir().ok();
    create_and_verify_backup_in_dirs_with_snapshots(
        &config_dir,
        app_data_dir.as_deref(),
        from_version,
        to_version,
        channel,
        intent,
        super::power::now_ms(),
        Some(owner_snapshots),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_env(label: &str) -> (PathBuf, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("monorail-backup-test-{label}-{nanos}"));
        let config_dir = root.join("config");
        let data_dir = root.join("data");
        fs::create_dir_all(&config_dir).unwrap();
        fs::create_dir_all(&data_dir).unwrap();
        fs::write(
            config_dir.join("config.json"),
            serde_json::json!({ "root": data_dir.to_string_lossy() }).to_string(),
        )
        .unwrap();
        (config_dir, data_dir)
    }

    #[test]
    fn sha256_matches_nist_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn creates_and_verifies_complete_backup_including_attachments_receipts_and_config_without_recursion() {
        let (config_dir, data_dir) = temp_env("complete");
        fs::write(data_dir.join("state.yaml"), "open_entry: e1\n").unwrap();
        fs::write(data_dir.join("settings.yaml"), "schemaVersion: 2\n").unwrap();
        fs::create_dir_all(data_dir.join("records")).unwrap();
        fs::write(data_dir.join("records/r1.md"), "---\nid: r1\n---\n想法内容").unwrap();
        fs::create_dir_all(data_dir.join("attachments/r1")).unwrap();
        fs::write(data_dir.join("attachments/r1/photo.png"), [0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]).unwrap();
        fs::create_dir_all(data_dir.join("receipts")).unwrap();
        fs::write(data_dir.join("receipts/op1.json"), r#"{"version":1,"operation_id":"op1"}"#).unwrap();
        fs::create_dir_all(data_dir.join(".journal")).unwrap(); // Empty journal dir is allowed.
        fs::write(config_dir.join("update-channel.json"), r#"{"channel":"beta","updatedAt":10}"#).unwrap();
        fs::write(config_dir.join("persisted-scope"), b"scope-bytes").unwrap();

        let first = create_and_verify_backup_in_dirs(
            &config_dir,
            None,
            "0.2.5",
            "0.3.0-beta.1",
            Channel::Beta,
            UpdateIntent::Upgrade,
            1000,
        )
        .unwrap();
        assert_eq!(first.file_count, 8);

        // A second backup must exclude the first backup directory and produce the exact same file count.
        let second = create_and_verify_backup_in_dirs(
            &config_dir,
            None,
            "0.3.0-beta.1",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            2000,
        )
        .unwrap();
        assert_eq!(second.file_count, 8);
        assert_eq!(read_last_backup_from_dir(&config_dir).unwrap().backup_id, second.backup_id);

        // Tampering with a backed-up attachment must fail verification.
        let second_path = PathBuf::from(&second.path);
        fs::write(second_path.join("data/attachments/r1/photo.png"), b"corrupted").unwrap();
        let err = verify_backup_dir(&second_path).unwrap_err();
        assert!(err.contains("attachments/r1/photo.png"), "{err}");

        let _ = fs::remove_dir_all(config_dir.parent().unwrap());
    }

    #[test]
    fn preserves_nested_directories_named_backups_inside_data_and_never_overwrites_same_timestamp_backup() {
        let (config_dir, data_dir) = temp_env("nested-and-unique");
        fs::write(data_dir.join("state.yaml"), "open_entry: e1\n").unwrap();
        // Legitimate user folders named `backups` or `.monorail-backups` inside data_dir must NOT be skipped
        fs::create_dir_all(data_dir.join("attachments/rec-1/backups")).unwrap();
        fs::write(
            data_dir.join("attachments/rec-1/backups/user-backup-note.txt"),
            b"user attachment inside backups folder",
        )
        .unwrap();
        fs::create_dir_all(data_dir.join("records/.monorail-backups")).unwrap();
        fs::write(
            data_dir.join("records/.monorail-backups/nested.md"),
            b"nested file",
        )
        .unwrap();

        // First backup at timestamp 5000
        let first = create_and_verify_backup_in_dirs(
            &config_dir,
            None,
            "0.3.0-beta.1",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            5000,
        )
        .unwrap();
        assert_eq!(first.backup_id, "5000-0.3.0-beta.1-to-0.2.5");
        let first_manifest = verify_backup_dir(Path::new(&first.path)).unwrap();
        assert!(
            first_manifest
                .files
                .iter()
                .any(|f| f.relative_path == "attachments/rec-1/backups/user-backup-note.txt"),
            "Nested backups directory in data_root must be preserved"
        );
        assert!(
            first_manifest
                .files
                .iter()
                .any(|f| f.relative_path == "records/.monorail-backups/nested.md"),
            "Nested .monorail-backups directory in data_root must be preserved"
        );

        // Second backup with the exact same timestamp and versions must NOT delete or overwrite `first`
        let second = create_and_verify_backup_in_dirs(
            &config_dir,
            None,
            "0.3.0-beta.1",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            5000,
        )
        .unwrap();
        assert_eq!(second.backup_id, "5000-0.3.0-beta.1-to-0.2.5-2");
        assert_ne!(first.path, second.path);
        // Both backup directories exist and pass verification independently without including each other
        assert!(verify_backup_dir(Path::new(&first.path)).is_ok());
        let second_manifest = verify_backup_dir(Path::new(&second.path)).unwrap();
        assert_eq!(first_manifest.files.len(), second_manifest.files.len());

        let _ = fs::remove_dir_all(config_dir.parent().unwrap());
    }

    #[test]
    fn owner_locked_config_snapshots_isolate_backup_from_concurrent_disk_mutations_in_lifecycle_and_reminders() {
        let (config_dir, data_dir) = temp_env("owner-snapshots");
        fs::write(data_dir.join("state.yaml"), "open_entry: e1\n").unwrap();
        // Disk files represent later concurrent background writes by heartbeat/power/reminder threads
        fs::write(config_dir.join("lifecycle.json"), br#"{"last_alive":999999,"events":[{"kind":"suspend"}]}"#).unwrap();
        fs::write(config_dir.join("reminders.json"), br#"["concurrent-later-reminder"]"#).unwrap();

        let locked_lifecycle = br#"{"last_alive":12345,"previous_last_alive":null,"startup_at":10000,"events":[]}"#.to_vec();
        let locked_reminders = br#"["pinned-reminder-at-checkpoint"]"#.to_vec();
        let snaps = OwnerConfigSnapshots {
            lifecycle_json: Some(locked_lifecycle.clone()),
            reminders_json: Some(locked_reminders.clone()),
        };

        let info = create_and_verify_backup_in_dirs_with_snapshots(
            &config_dir,
            None,
            "0.3.0-beta.2",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            6000,
            Some(&snaps),
        )
        .unwrap();

        let backup_path = PathBuf::from(&info.path);
        assert_eq!(fs::read(backup_path.join("config/lifecycle.json")).unwrap(), locked_lifecycle);
        assert_eq!(fs::read(backup_path.join("config/reminders.json")).unwrap(), locked_reminders);
        assert!(verify_backup_dir(&backup_path).is_ok());

        let _ = fs::remove_dir_all(config_dir.parent().unwrap());
    }

    #[test]
    fn unrecovered_journal_file_blocks_backup_and_install() {
        let (config_dir, data_dir) = temp_env("dirty-journal");
        fs::create_dir_all(data_dir.join(".journal")).unwrap();
        fs::write(data_dir.join(".journal/tx-1.json"), r#"{"id":"tx-1","writes":[]}"#).unwrap();

        let err = create_and_verify_backup_in_dirs(
            &config_dir,
            None,
            "0.3.0-beta.1",
            "0.2.5",
            Channel::Stable,
            UpdateIntent::ReturnToStable,
            3000,
        )
        .unwrap_err();
        assert!(err.contains(".journal"), "{err}");
        assert!(read_last_backup_from_dir(&config_dir).is_none());

        let _ = fs::remove_dir_all(config_dir.parent().unwrap());
    }
}
