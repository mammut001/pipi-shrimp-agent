import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore, useUIStore } from '@/store';

interface SkillRuntimeResult {
  success: boolean;
  status?: 'forked' | 'inline';
  output?: string;
  error?: string;
}

interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  content: string;
}

// These are discovery seeds, not documentation or fake skill objects. A card
// is only shown after execute_skill successfully loads a real SKILL.md. Users
// can probe any additional installed/custom skill by name below.
const DISCOVERY_SEEDS = [
  'autoresearch',
  'docx',
  'email',
  'form_fill',
  'pdf',
  'resume',
  'skill-creator',
  'web_research',
  'xlsx',
] as const;

function cleanFrontmatterValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function parseSkill(id: string, content: string): RuntimeSkill {
  let name = id;
  let description = 'Runtime skill loaded from SKILL.md';
  const lines = content.split(/\r?\n/);

  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]?.trim() || '';
      if (line === '---') break;
      if (line.startsWith('name:')) {
        const parsed = cleanFrontmatterValue(line.slice('name:'.length));
        if (parsed) name = parsed;
      } else if (line.startsWith('description:')) {
        const parsed = cleanFrontmatterValue(line.slice('description:'.length));
        if (parsed) description = parsed;
      }
    }
  }

  return { id, name, description, content };
}

async function loadRuntimeSkill(id: string, workDir?: string): Promise<RuntimeSkill | null> {
  const result = await invoke<SkillRuntimeResult>('execute_skill', {
    skillName: id,
    args: null,
    workDir: workDir || null,
  });
  if (!result.success || !result.output) return null;
  return parseSkill(id, result.output);
}

export function Skill() {
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const startSession = useChatStore((state) => state.startSession);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const updateSessionExecutionMode = useChatStore((state) => state.updateSessionExecutionMode);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const setActiveSkill = useUIStore((state) => state.setActiveSkill);

  const [skills, setSkills] = useState<RuntimeSkill[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [customSkillName, setCustomSkillName] = useState('');
  const [task, setTask] = useState('');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingSkill, setLoadingSkill] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const discover = async () => {
      setLoadingCatalog(true);
      setError(null);
      try {
        const results = await Promise.all(
          DISCOVERY_SEEDS.map(async (id) => {
            try {
              return await loadRuntimeSkill(id);
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const available = results.filter((skill): skill is RuntimeSkill => Boolean(skill));
        setSkills(available);
        setSelectedId((current) => current ?? available[0]?.id ?? null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    };

    void discover();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSkill = skills.find((skill) => skill.id === selectedId) ?? null;
  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) =>
      skill.id.toLowerCase().includes(query)
      || skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query),
    );
  }, [searchQuery, skills]);

  const probeCustomSkill = async () => {
    const id = customSkillName.trim();
    if (!id) return;
    if (!/^[\p{L}\p{N}_-]+$/u.test(id)) {
      setError('Skill name can only contain letters, numbers, dash, or underscore.');
      return;
    }

    setLoadingSkill(true);
    setError(null);
    try {
      const loaded = await loadRuntimeSkill(id);
      if (!loaded) {
        setError(`Skill "${id}" was not found in the runtime skill directories.`);
        return;
      }
      setSkills((current) => {
        const withoutDuplicate = current.filter((skill) => skill.id !== loaded.id);
        return [...withoutDuplicate, loaded].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedId(loaded.id);
      setCustomSkillName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingSkill(false);
    }
  };

  const runSelectedSkill = async () => {
    if (!selectedSkill || !task.trim() || running) return;

    setRunning(true);
    setError(null);
    try {
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = await startSession();
      }

      // Read the latest session only after startSession resolves so an existing
      // project folder can be passed into the skill runtime when available.
      const session = useChatStore.getState().sessions.find((item) => item.id === sessionId);
      const workDir = session?.projectDir || session?.cwd;
      const runtime = await invoke<SkillRuntimeResult>('execute_skill', {
        skillName: selectedSkill.id,
        args: task.trim(),
        workDir: workDir || null,
      });

      if (!runtime.success || !runtime.output) {
        throw new Error(runtime.error || `Failed to load ${selectedSkill.id}`);
      }

      // Skill execution is an explicit action, so move the session into the
      // tool-capable mode before sending. Danger still retains risky-action
      // approval and the destructive-operation double-check harness.
      await updateSessionExecutionMode(sessionId, 'danger');
      setActiveSkill(selectedSkill.name);
      setCurrentView('chat');

      await sendMessage(
        `Use the following installed runtime skill as the operating instructions for this task. Follow its workflow and safety constraints exactly.\n\n${runtime.output}`,
        sessionId,
      );

      window.setTimeout(() => setActiveSkill(null), 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setActiveSkill(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-screen min-h-0 bg-white text-gray-900">
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-gray-200 bg-gray-50/40">
        <div className="border-b border-gray-200 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">Skills</h1>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Only skills that successfully load a real SKILL.md are shown.
              </p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Runtime
            </span>
          </div>

          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter loaded skills…"
            className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loadingCatalog ? (
            <div className="px-3 py-8 text-center text-xs text-gray-500">Discovering runtime skills…</div>
          ) : filteredSkills.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-gray-500">No loaded skills match this filter.</div>
          ) : (
            <div className="space-y-1.5">
              {filteredSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => setSelectedId(skill.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedId === skill.id
                      ? 'border-gray-300 bg-white shadow-sm'
                      : 'border-transparent hover:border-gray-200 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{skill.name}</span>
                    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[9px] text-gray-500">{skill.id}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500">{skill.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Load installed/custom skill</label>
          <div className="mt-2 flex gap-2">
            <input
              value={customSkillName}
              onChange={(event) => setCustomSkillName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void probeCustomSkill();
              }}
              placeholder="skill-folder-name"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-gray-400"
            />
            <button
              type="button"
              disabled={loadingSkill || !customSkillName.trim()}
              onClick={() => void probeCustomSkill()}
              className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Load
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedSkill ? (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-7 py-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">{selectedSkill.name}</h2>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">
                    SKILL.md
                  </span>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">{selectedSkill.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentView('chat')}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Back to chat
              </button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-h-0 overflow-y-auto border-r border-gray-200 p-7">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Real runtime instructions</h3>
                  <span className="text-[10px] text-gray-400">Read-only preview</span>
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-2xl border border-gray-200 bg-gray-50 p-5 font-mono text-[11px] leading-relaxed text-gray-700">
                  {selectedSkill.content}
                </pre>
              </section>

              <section className="flex min-h-0 flex-col p-6">
                <div>
                  <h3 className="text-sm font-semibold">Run this skill</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                    The task is appended to the real SKILL.md and sent into a Danger-mode chat. Risky actions still keep approvals; destructive actions are double-checked by the mode harness.
                  </p>
                </div>
                <textarea
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  placeholder="Describe the concrete task for this skill…"
                  className="mt-4 min-h-[180px] flex-1 resize-none rounded-2xl border border-gray-200 p-3 text-sm leading-relaxed outline-none transition focus:border-gray-400"
                />
                <button
                  type="button"
                  disabled={running || !task.trim()}
                  onClick={() => void runSelectedSkill()}
                  className="mt-3 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {running ? 'Starting runtime…' : 'Run in Danger'}
                </button>
                <p className="mt-2 text-center text-[10px] text-gray-400">
                  No Skill delete/edit API is exposed from this page.
                </p>
              </section>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-md">
              <h2 className="text-base font-semibold">No runtime skill selected</h2>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                Load an installed skill by name, or check that the packaged SKILL.md directories are available.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="border-t border-rose-200 bg-rose-50 px-6 py-3 text-xs text-rose-700">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}

export default Skill;
