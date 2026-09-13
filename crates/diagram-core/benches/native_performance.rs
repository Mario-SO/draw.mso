use draw_diagram_core::{
    Document, DocumentPatch, Edge, Engine, Node, NodeKind, Side, validate_document,
};
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_WARMUPS: usize = 5;
const DEFAULT_SAMPLES: usize = 30;

#[derive(Clone, Copy)]
struct FixtureSpec {
    name: &'static str,
    nodes: usize,
    edges: usize,
    columns: usize,
    x_spacing: i32,
    y_spacing: i32,
    label_words: usize,
    boundaries: usize,
    origin: (i32, i32),
}

const FIXTURES: [FixtureSpec; 7] = [
    FixtureSpec {
        name: "small",
        nodes: 8,
        edges: 9,
        columns: 4,
        x_spacing: 18,
        y_spacing: 9,
        label_words: 2,
        boundaries: 0,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "medium",
        nodes: 64,
        edges: 96,
        columns: 8,
        x_spacing: 18,
        y_spacing: 9,
        label_words: 3,
        boundaries: 0,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "large",
        nodes: 300,
        edges: 450,
        columns: 20,
        x_spacing: 15,
        y_spacing: 8,
        label_words: 3,
        boundaries: 0,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "dense",
        nodes: 100,
        edges: 180,
        columns: 10,
        x_spacing: 12,
        y_spacing: 6,
        label_words: 2,
        boundaries: 0,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "long-labels",
        nodes: 48,
        edges: 64,
        columns: 8,
        x_spacing: 24,
        y_spacing: 10,
        label_words: 24,
        boundaries: 0,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "boundaries",
        nodes: 80,
        edges: 112,
        columns: 10,
        x_spacing: 17,
        y_spacing: 9,
        label_words: 3,
        boundaries: 8,
        origin: (0, 0),
    },
    FixtureSpec {
        name: "offscreen",
        nodes: 64,
        edges: 96,
        columns: 8,
        x_spacing: 18,
        y_spacing: 9,
        label_words: 3,
        boundaries: 0,
        origin: (-720, -480),
    },
];

#[derive(Default)]
struct Options {
    warmups: Option<usize>,
    samples: Option<usize>,
    fixture: Option<String>,
    operation: Option<String>,
    output: Option<PathBuf>,
    write_fixtures: Option<PathBuf>,
    profile_seconds: Option<u64>,
    list: bool,
}

fn main() {
    let options = parse_options();
    if options.list {
        for fixture in FIXTURES {
            println!("{}", fixture.name);
        }
        return;
    }
    if let Some(directory) = &options.write_fixtures {
        write_fixtures(&repository_path(directory), options.fixture.as_deref());
        return;
    }

    let warmups = options.warmups.unwrap_or(DEFAULT_WARMUPS);
    let samples = options.samples.unwrap_or(DEFAULT_SAMPLES);
    assert!(samples > 0, "--samples must be at least 1");
    if let Some(seconds) = options.profile_seconds {
        run_profile_loop(&options, seconds);
        return;
    }
    let mut results = Vec::new();
    for spec in FIXTURES {
        if !matches_filter(spec.name, options.fixture.as_deref()) {
            continue;
        }
        let document = fixture(spec);
        validate_document(&document).expect("generated fixture must be valid");
        let document_json = serde_json::to_string(&document).expect("serialize fixture");
        let patch = representative_patch(&document);
        for operation in [
            "load",
            "validate",
            "patch",
            "scene",
            "undo",
            "export-unicode",
            "export-ascii",
            "export-svg",
        ] {
            if !matches_filter(operation, options.operation.as_deref()) {
                continue;
            }
            eprintln!("benchmarking {}/{operation}", spec.name);
            let timings = measure(warmups, samples, || {
                timed_operation(operation, &document, &document_json, &patch)
            });
            results.push(json!({
                "fixture": spec.name,
                "operation": operation,
                "medianNs": percentile(&timings, 0.50),
                "p95Ns": percentile(&timings, 0.95),
                "minNs": timings[0],
                "maxNs": timings[timings.len() - 1],
                "samples": samples,
                "nodes": document.nodes.len(),
                "edges": document.edges.len(),
                "jsonBytes": document_json.len()
            }));
        }
    }
    assert!(!results.is_empty(), "filters selected no benchmark cases");
    let report = json!({
        "schemaVersion": 1,
        "suite": "diagram-core-native",
        "generatedAtUnixSeconds": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        "unit": "nanoseconds",
        "configuration": { "profile": "bench", "optLevel": 3, "lto": true, "codegenUnits": 1, "warmups": warmups, "samples": samples },
        "machine": machine_metadata(),
        "source": source_metadata(),
        "results": results
    });
    let rendered = serde_json::to_string_pretty(&report).expect("serialize report") + "\n";
    if let Some(path) = options.output.map(|path| repository_path(&path)) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create output directory");
        }
        fs::write(&path, rendered)
            .unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
        eprintln!("wrote {}", path.display());
    } else {
        print!("{rendered}");
    }
}

fn parse_options() -> Options {
    let mut options = Options::default();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--" | "--bench" => {}
            "--warmups" => {
                options.warmups = Some(value(&mut args, &arg).parse().expect("integer warmups"))
            }
            "--samples" => {
                options.samples = Some(value(&mut args, &arg).parse().expect("integer samples"))
            }
            "--fixture" => options.fixture = Some(value(&mut args, &arg)),
            "--operation" => options.operation = Some(value(&mut args, &arg)),
            "--output" => options.output = Some(value(&mut args, &arg).into()),
            "--write-fixtures" => options.write_fixtures = Some(value(&mut args, &arg).into()),
            "--profile-seconds" => {
                options.profile_seconds =
                    Some(value(&mut args, &arg).parse().expect("integer seconds"))
            }
            "--list-fixtures" => options.list = true,
            "--help" | "-h" => {
                println!(
                    "native_performance [--warmups N] [--samples N] [--fixture NAME] [--operation NAME] [--output PATH] [--write-fixtures DIR] [--profile-seconds N] [--list-fixtures]"
                );
                std::process::exit(0);
            }
            unknown => panic!("unknown argument {unknown:?}; use --help"),
        }
    }
    options
}

fn value(args: &mut impl Iterator<Item = String>, flag: &str) -> String {
    args.next()
        .unwrap_or_else(|| panic!("{flag} requires a value"))
}

fn matches_filter(value: &str, filter: Option<&str>) -> bool {
    filter.is_none_or(|filter| value == filter)
}

fn repository_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_owned();
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crate must be inside repository")
        .join(path)
}

fn measure(mut warmups: usize, samples: usize, mut operation: impl FnMut() -> u128) -> Vec<u128> {
    while warmups > 0 {
        black_box(operation());
        warmups -= 1;
    }
    let mut elapsed = Vec::with_capacity(samples);
    for _ in 0..samples {
        elapsed.push(operation());
    }
    elapsed.sort_unstable();
    elapsed
}

fn percentile(sorted: &[u128], quantile: f64) -> u128 {
    let index = ((sorted.len() as f64 * quantile).ceil() as usize).saturating_sub(1);
    sorted[index.min(sorted.len() - 1)]
}

fn timed_operation(
    operation: &str,
    document: &Document,
    document_json: &str,
    patch: &DocumentPatch,
) -> u128 {
    match operation {
        "load" => timed(|| black_box(Engine::new(black_box(document_json)).expect("load fixture"))),
        "validate" => timed(|| {
            validate_document(black_box(document)).expect("validate fixture");
            black_box(())
        }),
        "patch" => {
            let mut engine = Engine::from_document(document.clone()).expect("fixture engine");
            let patch = patch.clone();
            timed(|| {
                engine.apply_patch(black_box(patch)).expect("apply patch");
                black_box(())
            })
        }
        "scene" => {
            let engine = Engine::from_document(document.clone()).expect("fixture engine");
            timed(|| black_box(engine.scene()))
        }
        "undo" => {
            let mut engine = Engine::from_document(document.clone()).expect("fixture engine");
            engine.apply_patch(patch.clone()).expect("prepare undo");
            timed(|| {
                black_box(engine.undo());
                black_box(engine.document());
            })
        }
        "export-unicode" => {
            let engine = Engine::from_document(document.clone()).expect("fixture engine");
            timed(|| black_box(engine.export_text(false).expect("unicode export")))
        }
        "export-ascii" => {
            let engine = Engine::from_document(document.clone()).expect("fixture engine");
            timed(|| black_box(engine.export_text(true).expect("ASCII export")))
        }
        "export-svg" => {
            let engine = Engine::from_document(document.clone()).expect("fixture engine");
            timed(|| black_box(engine.export_svg().expect("SVG export")))
        }
        _ => unreachable!(),
    }
}

fn timed<T>(operation: impl FnOnce() -> T) -> u128 {
    let started = Instant::now();
    let output = black_box(operation());
    let elapsed = started.elapsed().as_nanos();
    black_box(output);
    elapsed
}

fn run_profile_loop(options: &Options, seconds: u64) {
    assert!(seconds > 0, "--profile-seconds must be at least 1");
    let spec = FIXTURES
        .into_iter()
        .find(|spec| matches_filter(spec.name, options.fixture.as_deref()))
        .expect("fixture filter selected no case");
    let operation = options.operation.as_deref().unwrap_or("scene");
    assert!(
        [
            "load",
            "validate",
            "patch",
            "scene",
            "undo",
            "export-unicode",
            "export-ascii",
            "export-svg"
        ]
        .contains(&operation),
        "unknown profile operation"
    );
    let document = fixture(spec);
    let document_json = serde_json::to_string(&document).expect("serialize fixture");
    let patch = representative_patch(&document);
    let deadline = Instant::now() + std::time::Duration::from_secs(seconds);
    let mut iterations = 0_u64;
    eprintln!(
        "profiling {}/{} for {seconds}s (pid {})",
        spec.name,
        operation,
        std::process::id()
    );
    while Instant::now() < deadline {
        black_box(timed_operation(
            operation,
            &document,
            &document_json,
            &patch,
        ));
        iterations += 1;
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": 1, "suite": "diagram-core-native-profile-loop", "fixture": spec.name,
            "operation": operation, "requestedSeconds": seconds, "iterations": iterations
        }))
        .unwrap()
    );
}

fn fixture(spec: FixtureSpec) -> Document {
    let mut nodes = Vec::with_capacity(spec.nodes + spec.boundaries);
    for index in 0..spec.nodes {
        let column = index % spec.columns;
        let row = index / spec.columns;
        let kind = match index % 4 {
            0 => NodeKind::Service,
            1 => NodeKind::Database,
            2 => NodeKind::Queue,
            _ => NodeKind::Text,
        };
        let words = (0..spec.label_words)
            .map(|word| format!("label{index}_{word}"))
            .collect::<Vec<_>>()
            .join(" ");
        nodes.push(Node {
            id: format!("node-{index:04}"),
            kind,
            label: words,
            title: None,
            title_position: None,
            group_id: (index % 7 == 0).then(|| format!("group-{:03}", index / 7)),
            x: spec.origin.0 + column as i32 * spec.x_spacing,
            y: spec.origin.1 + row as i32 * spec.y_spacing,
            width: if spec.name == "long-labels" { 20 } else { 10 },
            height: 5,
            border: None,
            text_align: None,
            vertical_align: None,
            padding: None,
            wrap_text: None,
            fill: None,
            shadow: None,
            hidden: None,
            locked: None,
            text_direction: None,
            line_direction: None,
        });
    }
    let rows = spec.nodes.div_ceil(spec.columns) as i32;
    for index in 0..spec.boundaries {
        let pair = index * 2;
        let row = pair / spec.columns;
        let column = pair % spec.columns;
        nodes.push(Node {
            id: format!("boundary-{index:03}"),
            kind: NodeKind::Boundary,
            label: format!("Boundary {index}"),
            title: None,
            title_position: None,
            group_id: None,
            x: spec.origin.0 + column as i32 * spec.x_spacing - 2,
            y: spec.origin.1 + row as i32 * spec.y_spacing - 2,
            width: spec.x_spacing * 2,
            height: (rows.min(3) * spec.y_spacing).max(8),
            border: None,
            text_align: None,
            vertical_align: None,
            padding: None,
            wrap_text: None,
            fill: None,
            shadow: None,
            hidden: None,
            locked: None,
            text_direction: None,
            line_direction: None,
        });
    }
    let mut edges = Vec::with_capacity(spec.edges);
    for index in 0..spec.edges {
        let from = index % spec.nodes;
        let stride = 1 + (index / spec.nodes) % (spec.columns.saturating_sub(1).max(1));
        let mut to = (from + stride) % spec.nodes;
        if to == from {
            to = (to + 1) % spec.nodes;
        }
        edges.push(Edge {
            id: format!("edge-{index:04}"),
            from: format!("node-{from:04}"),
            to: format!("node-{to:04}"),
            label: format!("flow-{index}"),
            from_side: (index % 3 == 0).then_some(Side::Right),
            to_side: (index % 3 == 0).then_some(Side::Left),
            from_point: None,
            to_point: None,
            start_arrow: None,
            end_arrow: None,
            line_style: None,
            routing: None,
        });
    }
    Document {
        version: 1,
        title: format!("Performance fixture: {}", spec.name),
        nodes,
        edges,
    }
}

fn representative_patch(document: &Document) -> DocumentPatch {
    let mut node = document.nodes[0].clone();
    node.x += 1;
    DocumentPatch {
        updated_nodes: vec![node],
        title: Some(format!("{} (patched)", document.title)),
        ..DocumentPatch::default()
    }
}

fn write_fixtures(directory: &Path, filter: Option<&str>) {
    fs::create_dir_all(directory)
        .unwrap_or_else(|error| panic!("create {}: {error}", directory.display()));
    let mut manifest = Vec::new();
    for spec in FIXTURES {
        if !matches_filter(spec.name, filter) {
            continue;
        }
        let document = fixture(spec);
        validate_document(&document).expect("generated fixture must be valid");
        let path = directory.join(format!("{}.mso", spec.name));
        let bytes = serde_json::to_vec_pretty(&document).expect("serialize fixture");
        fs::write(&path, &bytes)
            .unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
        manifest.push(json!({ "name": spec.name, "file": format!("{}.mso", spec.name), "nodes": document.nodes.len(), "edges": document.edges.len(), "bytes": bytes.len() }));
    }
    let manifest_path = directory.join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&json!({ "schemaVersion": 1, "fixtures": manifest })).unwrap(),
    )
    .unwrap_or_else(|error| panic!("write {}: {error}", manifest_path.display()));
    eprintln!("wrote fixtures to {}", directory.display());
}

fn output(command: &str, args: &[&str]) -> Option<String> {
    let result = Command::new(command).args(args).output().ok()?;
    result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn machine_metadata() -> Value {
    let cpu = output("sysctl", &["-n", "machdep.cpu.brand_string"]).or_else(|| {
        fs::read_to_string("/proc/cpuinfo").ok().and_then(|text| {
            text.lines()
                .find_map(|line| line.strip_prefix("model name\t: ").map(str::to_owned))
        })
    });
    json!({
        "os": output("uname", &["-s"]), "osRelease": output("uname", &["-r"]),
        "architecture": env::consts::ARCH, "cpu": cpu,
        "logicalCpus": std::thread::available_parallelism().map(|count| count.get()).ok(),
        "hostname": output("hostname", &[])
    })
}

fn source_metadata() -> Value {
    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|result| result.status.success())
        .map(|result| !result.stdout.is_empty());
    json!({
        "commit": output("git", &["rev-parse", "HEAD"]), "dirty": dirty,
        "rustc": output("rustc", &["--version"]), "cargo": output("cargo", &["--version"]),
        "executable": env::current_exe().ok().map(|path| path.display().to_string())
    })
}
