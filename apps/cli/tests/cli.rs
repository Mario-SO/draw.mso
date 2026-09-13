use std::fs;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_draw-mso"))
}

fn temp_file(name: &str, contents: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("draw-mso-{nonce}-{name}"));
    fs::write(&path, contents).unwrap();
    path
}

#[test]
fn json_errors_are_structured_on_stderr() {
    let mut child = binary()
        .args(["--json-errors", "validate"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(child.stdin.as_mut().unwrap(), b"{").unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["code"], "invalid_document_json");
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("invalid document JSON")
    );
}

#[test]
fn apply_patch_writes_a_new_document_without_overwriting_input() {
    let document = r#"{"version":1,"title":"before","nodes":[],"edges":[]}"#;
    let document_path = temp_file("document.mso", document);
    let patch_path = temp_file("patch.json", r#"{"title":"after"}"#);
    let output = binary()
        .args([
            "apply-patch",
            "--patch",
            patch_path.to_str().unwrap(),
            document_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    fs::remove_file(&patch_path).unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let updated: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(updated["title"], "after");
    assert_eq!(fs::read_to_string(&document_path).unwrap(), document);
    fs::remove_file(document_path).unwrap();
}

#[test]
fn schema_is_discoverable_without_input() {
    let output = binary().args(["schema", "document"]).output().unwrap();
    assert!(output.status.success());
    let schema: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(schema["properties"]["version"]["const"], 2);
}
