import json
from pathlib import Path


def main() -> None:
    Path('artifacts').mkdir(exist_ok=True)
    payload = {
        'metric': 'accuracy',
        'baseline': 'ResNet50',
        'dataset': 'CIFAR10',
        'value': 0.0,
    }
    print(json.dumps(payload))


if __name__ == '__main__':
    main()