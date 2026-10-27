use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

/// Keeps letters, digits, CJK and a few safe marks; never lets a name escape its directory.
fn clean(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    if trimmed.is_empty() {
        "附件".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// First free name: `a.png`, `a (2).png`, `a (3).png` ...
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = path.extension().and_then(|e| e.to_str());
    let mut candidate = dir.join(name);
    let mut n = 2;
    while candidate.exists() {
        let next = match ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        candidate = dir.join(next);
        n += 1;
    }
    candidate
}

/// Writes one attachment under `<root>/attachments/<record>/` and returns its data-relative path.
pub fn save(root: &Path, record: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    if record.len() != 36 || !record.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid record ID".into());
    }
    let dir = root.join("attachments").join(record);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = free_name(&dir, &clean(name));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("Bad name")?;
    Ok(format!("attachments/{record}/{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "0b7f3f52-6c55-4d7b-9f0e-3a6f8a2b1c9d";
    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("att-test-{}", super::super::power::now_ms()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn names_cannot_escape_and_are_deduplicated() {
        let root = temp();
        let a = save(&root, ID, "../../evil.txt", b"x").unwrap();
        let b = save(&root, ID, "evil.txt", b"y").unwrap();
        assert_eq!(a, format!("attachments/{ID}/evil.txt"));
        assert_eq!(b, format!("attachments/{ID}/evil (2).txt"));
        assert_eq!(fs::read(root.join(&b)).unwrap(), b"y");
    }
    #[test]
    fn rejects_bad_record_ids_and_empty_names() {
        let root = temp();
        assert!(save(&root, "../x", "a.png", b"").is_err());
        assert_eq!(save(&root, ID, "...", b"").unwrap(), format!("attachments/{ID}/附件"));
    }
}
