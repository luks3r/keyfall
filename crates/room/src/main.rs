use keyfall_room::{serve, Assets, Config, DirAssets, NoAssets, DEFAULT_PORT};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;

const USAGE: &str = "usage: keyfall-room [--host 0.0.0.0] [--port 7777] [--static ./dist] [--name NAME] [--max-rooms N] [--rooms-per-ip N]";

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let mut host = String::from("0.0.0.0");
    let mut port = DEFAULT_PORT;
    let mut assets_dir = Some(PathBuf::from("dist")).filter(|dir| dir.join("index.html").exists());
    let mut config = Config::public("Keyfall server");

    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args.next();
        let number = |value: &str| value.parse::<usize>().expect(USAGE);
        match (flag.as_str(), value) {
            ("--host", Some(value)) => host = value,
            ("--port", Some(value)) => port = value.parse().expect(USAGE),
            ("--static", Some(value)) => assets_dir = Some(PathBuf::from(value)),
            ("--name", Some(value)) => config.name = value,
            ("--max-rooms", Some(value)) => config.max_rooms = number(&value),
            ("--rooms-per-ip", Some(value)) => config.rooms_per_ip = number(&value),
            _ => {
                eprintln!("{USAGE}");
                std::process::exit(2);
            }
        }
    }

    let assets: Arc<dyn Assets> = match &assets_dir {
        Some(dir) => Arc::new(DirAssets(dir.clone())),
        None => Arc::new(NoAssets),
    };
    let listener = TcpListener::bind((host.as_str(), port)).await?;
    println!("{} on http://{}", config.name, listener.local_addr()?);
    match assets_dir {
        Some(dir) => println!("serving web app from {}", dir.display()),
        None => println!("no web app bundled; pass --static <dist>"),
    }
    serve(listener, assets, config).await
}
