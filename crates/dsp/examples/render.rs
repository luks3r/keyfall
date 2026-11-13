//! Render cost per audio block, as a share of the real-time budget.
//! cargo run -p keyfall-dsp --release --example render

use keyfall_dsp::{Engine, Instrument, Sample};
use std::hint::black_box;
use std::time::Instant;

const SAMPLE_RATE: f32 = 48_000.;
const BLOCK: usize = 128;
const BLOCKS: usize = 4_000;
const VOICES: [usize; 5] = [1, 8, 16, 32, 64];

/// Eight partials with filter and FM: the most expensive synth layout `Instrument::decode` accepts.
fn heavy_synth() -> Instrument {
    let mut data = vec![0., 0.004, 4., 0.6, 0.3, 1., 1., 1., 400., 1.5, 2., 1., 1., 2., 1.5, 0.4, 8.];
    for i in 0..8 {
        data.extend([1. + i as f32, (i % 4) as f32, 0.2, 3.]);
    }
    Instrument::decode(&data).expect("valid patch")
}

fn sampler(engine: &mut Engine) -> Instrument {
    let length = SAMPLE_RATE as usize * 8;
    let data: Vec<f32> = (0..length).map(|i| (i as f32 * 0.05).sin() * 0.5).collect();
    for root in (21..=108).step_by(3) {
        engine.add_sample(Sample { root, rate: SAMPLE_RATE, data: data.clone().into() });
    }
    Instrument::decode(&[1., 0.3, 1.]).expect("valid sampler")
}

fn measure(name: &str, instrument: &dyn Fn(&mut Engine) -> Instrument) {
    let budget_us = BLOCK as f64 / SAMPLE_RATE as f64 * 1e6;
    for voices in VOICES {
        let mut engine = Engine::new(SAMPLE_RATE);
        let instrument = instrument(&mut engine);
        engine.set_instrument(0, instrument);
        for v in 0..voices {
            engine.note_on(v as u32, 0, 36 + v as u8, 0.8);
        }
        let mut worst = 0f64;
        let started = Instant::now();
        for _ in 0..BLOCKS {
            let block = Instant::now();
            black_box(engine.render_block(BLOCK));
            worst = worst.max(block.elapsed().as_secs_f64() * 1e6);
        }
        let mean = started.elapsed().as_secs_f64() * 1e6 / BLOCKS as f64;
        println!(
            "{name:<7} {voices:>2} voices  mean {mean:>6.2} µs ({:>5.2}% of {budget_us:.0} µs)  worst {worst:>6.1} µs",
            mean / budget_us * 100.
        );
    }
}

fn main() {
    println!("{BLOCK}-frame blocks at {SAMPLE_RATE} Hz, {BLOCKS} blocks per row");
    measure("synth", &|_| heavy_synth());
    measure("sampler", &sampler);
}
