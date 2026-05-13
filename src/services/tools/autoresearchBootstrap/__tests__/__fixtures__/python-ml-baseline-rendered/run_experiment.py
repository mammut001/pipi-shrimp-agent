import subprocess


def run(command: str) -> None:
    completed = subprocess.run(command, shell=True, check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


if __name__ == '__main__':
    run('python3 train.py')
    run('python3 eval.py')