import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const TELEGRAM_INVOKE_COMMANDS = [
  'telegram_connect',
  'telegram_disconnect',
  'telegram_send_message',
  'telegram_get_status',
  'telegram_get_bot_info',
  'telegram_validate_token',
  'telegram_get_pending_count',
  'telegram_set_command_prefix',
  'telegram_set_allowed_chats',
  'telegram_download_file',
  'telegram_get_file_url',
  'telegram_send_typing',
  'telegram_send_chat_action',
  'telegram_answer_callback_query',
  'telegram_get_updates',
  'telegram_set_webhook',
  'telegram_delete_webhook',
  'telegram_get_webhook_info',
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('telegram invoke / Rust handler parity (R7-12)', () => {
  it('registers every telegramService invoke in lib.rs', () => {
    const libRs = readRepoFile('src-tauri/src/lib.rs');

    for (const command of TELEGRAM_INVOKE_COMMANDS) {
      expect(libRs).toContain(`commands::${command}`);
    }
  });

  it('telegram_set_allowed_chats invoke remains in telegramService', () => {
    const serviceSource = readRepoFile('src/services/telegramService.ts');
    expect(serviceSource).toContain("invoke('telegram_set_allowed_chats'");
  });
});