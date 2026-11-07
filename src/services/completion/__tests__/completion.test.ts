import { normalizeAcceptanceCommands, parseAcceptanceCommandsText } from '../contract';
import { parseDeliveryReport } from '../delivery';
import { evaluateCompletion, buildCompletionRepairMessage } from '../evaluate';
import { defaultCompletionContract } from '../contract';

describe('completion contract', () => {
  it('normalizes mixed acceptance command inputs', async () => {
    const { normalizeAcceptanceCommands } = await import('../contract');
    expect(
      normalizeAcceptanceCommands([' pnpm test ', { command: 'pnpm lint', timeoutMs: 5000 }, { command: '' }, 42, null]),
    ).toEqual([{ command: 'pnpm test' }, { command: 'pnpm lint', timeoutMs: 5000 }]);
    expect(normalizeAcceptanceCommands(undefined)).toEqual([]);
    expect(parseAcceptanceCommandsText('a\n\nb\n')).toEqual([{ command: 'a' }, { command: 'b' }]);
  });
});

describe('delivery report', () => {
  it('accepts a valid block', () => {
    const parsed = parseDeliveryReport(
      '做了事情\n[[DELIVERY]]\n{"summary":"做了","files_changed":["a.ts"],"commands_run":[{"command":"pnpm test","exit_code":0}]}\n[[/DELIVERY]]',
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects missing block, bad json, and fenced blocks', () => {
    expect(parseDeliveryReport('只有正文')).toMatchObject({ ok: false });
    expect(parseDeliveryReport('[[DELIVERY]]{bad}[[/DELIVERY]]')).toMatchObject({ ok: false, kind: 'delivery_invalid_json' });
    expect(parseDeliveryReport('```\n[[DELIVERY]]\n{"summary":"x","files_changed":[],"commands_run":[]}\n[[/DELIVERY]]\n```')).toMatchObject({
      ok: false,
      kind: 'delivery_missing',
    });
  });

  it('rejects wrong field types', () => {
    expect(
      parseDeliveryReport('[[DELIVERY]]{"summary":"","files_changed":[],"commands_run":[]}[[/DELIVERY]]'),
    ).toMatchObject({ ok: false, kind: 'delivery_missing_summary' });
    expect(
      parseDeliveryReport('[[DELIVERY]]{"summary":"x","files_changed":"a","commands_run":[]}[[/DELIVERY]]'),
    ).toMatchObject({ ok: false, kind: 'delivery_invalid_files_changed' });
    expect(
      parseDeliveryReport('[[DELIVERY]]{"summary":"x","files_changed":[],"commands_run":[{"command":"a"}]}[[/DELIVERY]]'),
    ).toMatchObject({ ok: false, kind: 'delivery_invalid_commands_run' });
  });
});

describe('evaluateCompletion', () => {
  it('fails empty output and ignores self-reported exit codes', () => {
    const evaluation = evaluateCompletion(defaultCompletionContract(), { finalText: '   ' });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failureKinds).toContain('empty_output');
    expect(evaluation.failureKinds).toContain('delivery_invalid');
  });

  it('fails when an acceptance command exits non-zero', () => {
    const contract = { ...defaultCompletionContract(), requireDeliveryReport: false };
    const evaluation = evaluateCompletion(contract, {
      finalText: 'done',
      acceptanceResults: [
        { command: 'pnpm test', status: 'failed', exitCode: 1, stdout: 'fail', stderr: '', durationMs: 1 },
      ],
    });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failureKinds).toContain('acceptance_failed');
  });

  it('treats blocked commands as failures, not passes', () => {
    const contract = { ...defaultCompletionContract(), requireDeliveryReport: false };
    const evaluation = evaluateCompletion(contract, {
      finalText: 'done',
      acceptanceResults: [
        { command: 'pnpm test', status: 'blocked', exitCode: null, stdout: '', stderr: '', detail: 'no workDir', durationMs: 0 },
      ],
    });
    expect(evaluation.pass).toBe(false);
    expect(evaluation.failureKinds).toContain('acceptance_blocked');
  });

  it('builds a repair message without asking the model to self-judge', () => {
    const contract = { ...defaultCompletionContract(), requireDeliveryReport: false };
    const evaluation = evaluateCompletion(contract, { finalText: '' });
    const message = buildCompletionRepairMessage({ evaluation, attempt: 1, maxAttempts: 1 });
    expect(message).toContain('[[DELIVERY]]');
    expect(message).not.toContain('请你自行判断已经完成');
  });
});
