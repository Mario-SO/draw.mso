use draw_diagram_core::Engine;
use std::fs;
use std::io::{self, Read};
use std::process::ExitCode;

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(output) => {
            if let Some(value) = output {
                print!("{value}");
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("draw-mso: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<Option<String>, String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Err(usage());
    };
    match command {
        "validate" => {
            if args.len() > 2 {
                return Err(usage());
            }
            let input = read_input(args.get(1))?;
            Engine::new(&input).map_err(|e| e.to_string())?;
            Ok(None)
        }
        "export" => {
            if args.get(1).map(String::as_str) != Some("--format") {
                return Err(usage());
            }
            let format = args.get(2).ok_or_else(usage)?;
            if !matches!(format.as_str(), "ascii" | "unicode" | "svg") {
                return Err(format!(
                    "unknown export format {format:?}; expected ascii, unicode, or svg"
                ));
            }
            if args.len() > 4 {
                return Err(usage());
            }
            let input = read_input(args.get(3))?;
            let engine = Engine::new(&input).map_err(|e| e.to_string())?;
            let result = match format.as_str() {
                "ascii" => engine.export_text(true),
                "unicode" => engine.export_text(false),
                "svg" => engine.export_svg(),
                _ => unreachable!("format checked above"),
            }
            .map_err(|e| e.to_string())?;
            Ok(Some(result))
        }
        _ => Err(usage()),
    }
}

fn read_input(path: Option<&String>) -> Result<String, String> {
    match path {
        Some(path) if path != "-" => {
            fs::read_to_string(path).map_err(|e| format!("cannot read {path:?}: {e}"))
        }
        _ => {
            let mut data = String::new();
            io::stdin()
                .read_to_string(&mut data)
                .map_err(|e| format!("cannot read stdin: {e}"))?;
            Ok(data)
        }
    }
}

fn usage() -> String {
    "usage: draw-mso validate [FILE]\n       draw-mso export --format ascii|unicode|svg [FILE]"
        .into()
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
        assert!(err.contains("unknown export format"));
    }
    #[test]
    fn usage_is_helpful() {
        assert!(run(vec![]).unwrap_err().contains("draw-mso export"));
    }
}
