"""Record actual teacher-free greedy generation. Run on Linux CPU, Python 3.11."""
import argparse
import base64
import gzip
import hashlib
import json
import os
import platform
import statistics
import time
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from transformers import AutoModelForCausalLM, AutoTokenizer, DynamicCache

MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct"
REV = "12fd25f77366fa6b3b4b768ec3050bf629380bac"
QUESTION = "What is the value of num_hidden_layers? Reply with just the number."
REPEATS = 5
FILES = ["model.safetensors", "config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "generation_config.json"]

def make_prompts(configuration, tokenizer_configuration):
    layer_line = next(line for line in configuration.splitlines() if '"num_hidden_layers"' in line)
    contexts = {
        "short": layer_line.strip().rstrip(","),
        "long": configuration.strip(),
        "bundle": configuration.strip() + "\n\nTokenizer configuration:\n" + tokenizer_configuration.strip(),
    }
    return {key: "Model configuration:\n" + text + "\n\n" + QUESTION for key, text in contexts.items()}


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def rss():
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    raise RuntimeError("Resident set size is unavailable")


@torch.inference_mode()
def generate(model, tok, ids):
    cache = DynamicCache()
    input_ids = ids
    records = []
    for i in range(12):
        start = time.perf_counter_ns()
        result = model(input_ids=input_ids, past_key_values=cache, use_cache=True)
        token = int(result.logits[0, -1].argmax())
        elapsed = time.perf_counter_ns() - start
        cache = result.past_key_values
        records.append({
            "phase": "prefill" if i == 0 else "decode", "ns": elapsed,
            "id": token, "piece": tok.decode([token], skip_special_tokens=False, clean_up_tokenization_spaces=False),
            "positions": int(cache.get_seq_length()),
            "kvBytes": sum(t.nelement() * t.element_size() for t in [*cache.key_cache, *cache.value_cache]),
            "rssBytes": rss()
        })
        del result
        if token == tok.eos_token_id:
            break
        input_ids = torch.tensor([[token]], dtype=torch.long)
    return {"steps": records, "output": tok.decode([s["id"] for s in records], skip_special_tokens=True, clean_up_tokenization_spaces=False)}


def record():
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    root = Path(snapshot_download(MODEL, revision=REV, allow_patterns=FILES))
    tok = AutoTokenizer.from_pretrained(root, local_files_only=True)
    t0 = time.perf_counter_ns()
    model = AutoModelForCausalLM.from_pretrained(root, torch_dtype=torch.float32, attn_implementation="eager", local_files_only=True).eval()
    load_ns = time.perf_counter_ns() - t0
    cases = {}
    tensors = {}
    configuration = (root / "config.json").read_text(encoding="utf-8")
    tokenizer_configuration = (root / "tokenizer_config.json").read_text(encoding="utf-8")
    for key, prompt in make_prompts(configuration, tokenizer_configuration).items():
        msgs = [{"role": "user", "content": prompt}]
        ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt")
        tensors[key] = ids
        cases[key] = {"prompt": prompt, "inputIds": ids[0].tolist(), "runs": []}
    # Capture the process-first call separately. Warm up each condition before interleaving repetitions.
    cold = generate(model, tok, tensors["short"])
    for key in cases:
        generate(model, tok, tensors[key])
    keys = list(cases)
    for rep in range(REPEATS):
        for key in keys[rep % len(keys):] + keys[:rep % len(keys)]:
            cases[key]["runs"].append(generate(model, tok, tensors[key]))
    for case in cases.values():
        case["shown"] = sorted(range(REPEATS), key=lambda j: case["runs"][j]["steps"][0]["ns"])[REPEATS//2]
    config = model.config
    return {
        "schema": 3, "date": datetime.now(timezone.utc).isoformat(), "model": MODEL,
        "revision": REV, "tokenizerRevision": REV, "license": "Apache-2.0", "eos": tok.eos_token_id,
        "hashes": {p.name: sha(p) for p in sorted(root.iterdir()) if p.name in FILES},
        "runtime": {p: version(p) for p in ["torch","transformers","tokenizers","huggingface-hub","safetensors","numpy"]},
        "device": "CPU", "dtype": "float32", "threads": torch.get_num_threads(),
        "cpu": next(line.split(":",1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")),
        "os": platform.platform(), "python": platform.python_version(), "backend": "eager",
        "runId": os.environ.get("GITHUB_RUN_ID"), "commit": os.environ.get("GITHUB_SHA"),
        "question": QUESTION, "loadNs": load_ns, "firstCall": cold, "warmupsPerCase": 1,
        "weightsBytes": sum(p.nelement()*p.element_size() for p in model.parameters()),
        "architecture": {"layers":config.num_hidden_layers, "kvHeads":config.num_key_value_heads, "headDimension":config.hidden_size//config.num_attention_heads,"cacheBits":32},
        "maxOutputTokens":12, "cases":cases
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    parser.add_argument("--print-archive", action="store_true")
    args = parser.parse_args()
    data = record()
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    args.destination.write_bytes(raw)
    if args.print_archive:
        archive = base64.b64encode(gzip.compress(raw)).decode()
        print("RECORD_SHA256=" + hashlib.sha256(raw).hexdigest())
        for i in range(0, len(archive), 700):
            print("RECORD_PART=" + archive[i:i+700])
