from pathlib import Path


def main() -> None:
    Path('artifacts').mkdir(exist_ok=True)
    print('Training placeholder for test-project')


if __name__ == '__main__':
    main()