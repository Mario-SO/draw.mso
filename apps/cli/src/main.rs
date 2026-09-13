use draw_diagram_core::{DOCUMENT_SCHEMA_JSON, Engine, PATCH_SCHEMA_JSON};
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::process::ExitCode;

#[derive(Debug, Serialize)]
struct CliError {
    code: String,
    message: String,
}

impl CliError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    fn core(error: draw_diagram_core::DiagramError) -> Self {
        Self::new(error.code().as_str(), error.to_string())
    }
}

fn main() -> ExitCode {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let json_errors = args.first().is_some_and(|arg| arg == "--json-errors");
    if json_errors {
        args.remove(0);
    }
    match run(args) {
        Ok(output) => {
            if let Some(value) = output {
                print!("{value}");
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            if json_errors {
                eprintln!(
                    "{}",
                    serde_json::to_string(&error).expect("serializable CLI error")
                );
            } else {
                eprintln!("draw-mso: {}", error.message);
            }
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<Option<String>, CliError> {
    let Some(command) = args.first().map(String::as_str) else {
        return Err(usage_error());
    };
    match command {
        "validate" => {
            if args.len() > 2 {
                return Err(usage_error());
            }
            Engine::new(&read_input(args.get(1))?).map_err(CliError::core)?;
            Ok(None)
        }
        "inspect" => {
            if args.len() > 2 {
                return Err(usage_error());
            }
            let engine = Engine::new(&read_input(args.get(1))?).map_err(CliError::core)?;
            Ok(Some(pretty_document(&engine)))
        }
        "apply-patch" => apply_patch_command(&args),
        "schema" => {
            if args.len() > 2 {
                return Err(usage_error());
            }
            match args.get(1).map(String::as_str).unwrap_or("document") {
                "document" => Ok(Some(DOCUMENT_SCHEMA_JSON.into())),
                "patch" => Ok(Some(PATCH_SCHEMA_JSON.into())),
                name => Err(CliError::new(
                    "unknown_schema",
                    format!("unknown schema {name:?}; expected document or patch"),
                )),
            }
        }
        "export" => {
            if args.get(1).map(String::as_str) != Some("--format") {
                return Err(usage_error());
            }
            let format = args.get(2).ok_or_else(usage_error)?;
            if !matches!(format.as_str(), "ascii" | "unicode" | "svg") {
                return Err(CliError::new(
                    "unknown_export_format",
                    format!("unknown export format {format:?}; expected ascii, unicode, or svg"),
                ));
            }
            if args.len() > 4 {
                return Err(usage_error());
            }
            let engine = Engine::new(&read_input(args.get(3))?).map_err(CliError::core)?;
            let result = match format.as_str() {
                "ascii" => engine.export_text(true),
                "unicode" => engine.export_text(false),
                "svg" => engine.export_svg(),
                _ => unreachable!("format checked above"),
            }
            .map_err(CliError::core)?;
            Ok(Some(result))
        }
        _ => Err(usage_error()),
    }
}

fn apply_patch_command(args: &[String]) -> Result<Option<String>, CliError> {
    if args.get(1).map(String::as_str) != Some("--patch") || !(3..=4).contains(&args.len()) {
        return Err(usage_error());
    }
    let patch_path = &args[2];
    if patch_path == "-" && args.get(3).is_none_or(|path| path == "-") {
        return Err(CliError::new(
            "ambiguous_stdin",
            "the document and patch cannot both be read from stdin",
        ));
    }
    let document = read_input(args.get(3))?;
    let patch = read_input(Some(patch_path))?;
    let mut engine = Engine::new(&document).map_err(CliError::core)?;
    engine.apply_patch_json(&patch).map_err(CliError::core)?;
    Ok(Some(pretty_document(&engine)))
}

fn pretty_document(engine: &Engine) -> String {
    let value: serde_json::Value =
        serde_json::from_str(&engine.document_json()).expect("core document is valid JSON");
    format!(
        "{}\n",
        serde_json::to_string_pretty(&value).expect("serializable document")
    )
}

fn read_input(path: Option<&String>) -> Result<String, CliError> {
    match path {
        Some(path) if path != "-" => fs::read_to_string(path)
            .map_err(|e| CliError::new("input_read_failed", format!("cannot read {path:?}: {e}"))),
        _ => {
            let mut data = String::new();
            io::stdin().read_to_string(&mut data).map_err(|e| {
                CliError::new("input_read_failed", format!("cannot read stdin: {e}"))
            })?;
            Ok(data)
        }
    }
}

fn usage_error() -> CliError {
    CliError::new("usage", usage())
}
fn usage() -> String {
    "usage: draw-mso [--json-errors] validate [FILE]\n       draw-mso [--json-errors] inspect [FILE]\n       draw-mso [--json-errors] apply-patch --patch PATCH_FILE [FILE]\n       draw-mso [--json-errors] schema [document|patch]\n       draw-mso [--json-errors] export --format ascii|unicode|svg [FILE]".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_format_before_reading_input() {
        let err = run(vec![
            "export".into(),
            "--format".into(),
            "pdf".into(),
            "no-file".into(),
        ])
        .unwrap_err();
        assert_eq!(err.code, "unknown_export_format");
    }
    #[test]
    fn usage_is_helpful() {
        let message = run(vec![]).unwrap_err().message;
        assert!(message.contains("draw-mso"));
        assert!(message.contains("export --format"));
    }
    #[test]
    fn exposes_both_schemas() {
        assert!(
            run(vec!["schema".into()])
                .unwrap()
                .unwrap()
                .contains("\"version\"")
        );
        assert!(
            run(vec!["schema".into(), "patch".into()])
                .unwrap()
                .unwrap()
                .contains("addedNodes")
        );
    }
}
