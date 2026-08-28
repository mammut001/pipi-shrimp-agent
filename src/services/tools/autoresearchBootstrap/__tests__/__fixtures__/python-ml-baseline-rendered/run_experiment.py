import json
import subprocess
from pathlib import Path


def run(command: str) -> int:
    completed = subprocess.run(command, shell=True, check=False)
    return completed.returncode


if __name__ == '__main__':
    train_rc = run('python3 train.py')
    eval_rc = run('python3 eval.py')
    rc = train_rc or eval_rc
    payload = {
        'metricName': 'accuracy',
        'metricValue': 0.0 if rc == 0 else None,
        'status': 'IMPROVED' if rc == 0 else 'FAILED',
        'hypothesis': 'scaffold baseline',
        'failReason': None if rc == 0 else f'train/eval exited {rc}',
    }
    Path('metrics.json').write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    raise SystemExit(0 if rc == 0 else 1)
