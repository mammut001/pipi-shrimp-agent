# Documentation

This directory holds detailed per-subsystem documentation that doesn't fit
neatly into the top-level [`README.md`](../README.md). The top-level README
remains the entry point for new users; docs here are for contributors and
maintainers who need deeper context.

---

## 馃梻锔?Index

| Subsystem | Document | What it covers | Language |
|-----------|----------|----------------|----------|
| AutoResearch | [`audits/auto-research.md`](./audits/auto-research.md) | Audit history, anchored fix log, design rationale, regression-test backlog | EN |
| Full Codebase (10 rounds) | [`audits/full-codebase.md`](./audits/full-codebase.md) | 10-round audit summary (97 issues), fix log by P0/P1/P2/P3 priority, anchor index, backlog | EN |
| Browser Automation | [`design/browser-automation.md`](./design/browser-automation.md) | Engine selection, action policy, vision fallback, observability, embedded surface, test map | EN |
| Folders & Runs (concepts) | [`concepts/folders-and-runs.md`](./concepts/folders-and-runs.md) | Project Folder, PiPi Output Folder, Context Files, AutoResearch Workspace, Target Project, Scaffold Folder, Run Dir, Living Doc, Artifacts 鈥?owners, readers, writers, defaults, common mistakes | EN |
| Execution Modes (concepts) | [`concepts/execution-modes.md`](./concepts/execution-modes.md) | Ask / Plan / Debug / Agent / Bypass 鈥?registry, allowed tools, hard-enforcement points, tests that protect each mode, UI鈫攅nforcement honesty | EN |
| AutoResearch Runtime (concepts) | [`concepts/autoresearch-runtime.md`](./concepts/autoresearch-runtime.md) | Guided vs manual bootstrap, local vs SSH, connection test, run lifecycle, artifacts / living doc / result.json, hard runtime vs prompt-only settings | EN |
| Complexity Governance | [`architecture/complexity-governance.md`](./architecture/complexity-governance.md) | File-size thresholds, component / hook / pure-logic split rules, state-machine recommendation, PR size, required tests before extraction, how to run `npm run report:complexity` | EN |
| Refactor Plan | [`architecture/refactor-plan.md`](./architecture/refactor-plan.md) | Per-anchor split roadmap for every `>800` LOC file (AG-01..AG-35 + TEST-01..TEST-06), wave definitions, promotion criteria for `500-800` LOC files, retirement protocol | EN |

---

## 馃摉 How docs are organized

Three kinds of document live here, each with a different audience:

### `audits/` 鈥?Code-audit history
**Audience:** anyone changing AutoResearch code, doing a code review, or
investigating a regression.

These files record the issues found during systematic audits, the fixes
that landed, and the `file:line` of each change. They also include
design rationale and a regression-test backlog.

**Conventions used:**

- Fixes are anchored in the source with `// AUDIT-FIX [audit-N-ar#M]`
  comments. `N` is the round number (1, 2, 3, 鈥?, `M` is the issue
  number within that round. The `-ar` namespace suffix keeps
  AutoResearch anchors distinct from chat-module anchors
  (`[audit-N#M]`), which are tracked separately.
- Each anchor's full comment block explains the original bug, the
  invariant the fix maintains, and (where useful) cross-references
  to other anchors.
- The audit doc is **append-only**: future rounds get a new section
  at the bottom; existing entries are never edited, only referenced
  from the new ones.

**Quick reference:**

```bash
# All AutoResearch anchored fixes
rg "AUDIT-FIX \[audit-\d+-ar#" src/

# Just the third-round AutoResearch fixes
rg "AUDIT-FIX \[audit-3-ar#" src/

# All audit anchors in the project (chat + AutoResearch)
rg "AUDIT-FIX \[audit-" src/
```

### Future: `design/`, `runbooks/`, `migration/`
Reserved for the same per-subsystem split as `audits/`. The
[`design/browser-automation.md`](./design/browser-automation.md) doc is the
first entry under `design/`.

---

## 馃寪 Bilingual policy

Top-level `README.md` is **bilingual (English + 绠€浣撲腑鏂?** to keep the
project approachable for both audiences. Docs in this directory are
**English-only** by default unless the doc's filename or frontmatter
indicates otherwise 鈥?they target maintainers, who we expect to read
English. If you need a Chinese version, please open an issue rather
than maintaining a parallel translation.

---

## 鉁嶏笍 Adding a new document

1. Decide which subdirectory fits: `audits/`, `design/`, `runbooks/`,
   `migration/`, or a new category. Add the subdirectory if it doesn't
   exist.
2. Filename: `kebab-case.md`. Suffix with the subsystem name
   (`auto-research.md`, `chat-compression.md`).
3. The first `# H1` should be the subsystem name. The first paragraph
   should be a one-sentence elevator pitch.
4. Link from this index (the table above) and from the top-level
   `README.md` if the subsystem is user-facing.
5. If the document records audit findings, follow the conventions in
   the **"audits/"** section above (anchors, append-only structure,
   file:line in tables).

---

## 馃Л Maintenance

These documents are maintained alongside the code. When you change
code near an `AUDIT-FIX` anchor:

1. Re-read the anchor's full comment to make sure your change preserves
   the invariant.
2. If the change weakens or alters the invariant, update the anchor
   *and* the corresponding row in the audit doc.
3. If the change introduces a *new* issue that needs tracking, add
   `[audit-N+1#X]` to the next round's section.

When the source code referenced by a doc moves (file rename, line
shift), the `file:line` references go stale. Periodic regen:

```bash
# After large refactors, re-grep the file:line references and update
# the docs. The anchors themselves are the source of truth 鈥?if a
# refactor moves an anchor, the line number in the doc will be off
# but the AUDIT-FIX ID still points at the right place.
rg "AUDIT-FIX \[audit-\d+-ar#" src/ -n
```

---

---

# 鏂囨。

鏈洰褰曞瓨鏀句笉閫傚悎濉炶繘椤跺眰 [`README.md`](../README.md) 鐨勫瓙绯荤粺绾ф枃妗ｃ€?`README.md` 闈㈠悜鏂扮敤鎴凤紱杩欓噷鐨勬枃妗ｉ潰鍚戣础鐚€呭拰缁存姢鑰咃紝闇€瑕佹洿娣卞叆
鐨勪笂涓嬫枃銆?
---

## 馃梻锔?绱㈠紩

| 瀛愮郴缁?| 鏂囨。 | 鍐呭 | 璇█ |
|--------|------|------|------|
| AutoResearch | [`audits/auto-research.md`](./audits/auto-research.md) | 瀹¤鍘嗗彶銆侀敋瀹氫慨澶嶆棩蹇椼€佽璁＄悊鐢便€佸洖褰掓祴璇曟竻鍗?| 鑻辨枃 |
| 娴忚鍣ㄨ嚜鍔ㄥ寲 | [`design/browser-automation.md`](./design/browser-automation.md) | 寮曟搸閫夋嫨銆佸姩浣滅瓥鐣ャ€佽瑙夊洖閫€銆佸彲瑙傛祴鎬с€佸祵鍏ュ紡 WebView銆佹祴璇曠煩闃?| 鑻辨枃 |
| 鏂囦欢澶逛笌杩愯锛堟蹇碉級 | [`concepts/folders-and-runs.md`](./concepts/folders-and-runs.md) | Project Folder / PiPi Output Folder / Context Files / AutoResearch Workspace / Target Project / Scaffold Folder / Run Dir / Living Doc / Artifacts 鐨勬墍鏈夎€呫€佽鑰呫€佸啓鍏ヨ€呫€侀粯璁ゅ€笺€佸父瑙侀敊璇?| 鑻辨枃 |
| 鎵ц妯″紡锛堟蹇碉級 | [`concepts/execution-modes.md`](./concepts/execution-modes.md) | Ask / Plan / Debug / Agent / Bypass 鐨勬敞鍐岃〃銆佸厑璁哥殑宸ュ叿銆佸己鍒舵墽琛岀偣銆佸畧鎶ゆ祴璇曘€乁I 涓庢墽琛屽眰鐨勪竴鑷存€?| 鑻辨枃 |
| AutoResearch 杩愯鏃讹紙姒傚康锛?| [`concepts/autoresearch-runtime.md`](./concepts/autoresearch-runtime.md) | 鍚戝寮?vs 鎵嬪姩鍚姩寮曞銆佹湰鍦?vs SSH銆佽繛鎺ユ祴璇曘€佽繍琛岀敓鍛藉懆鏈熴€佷骇鐗?/ living doc / result.json銆佺‖鎬ц繍琛屾椂璁剧疆 vs 浠呬綔涓烘彁绀鸿瘝鐨勮缃?| 鑻辨枃 |
| 澶嶆潅搴︽不鐞?| [`architecture/complexity-governance.md`](./architecture/complexity-governance.md) | 鏂囦欢澶у皬闃堝€笺€佺粍浠?/ Hook / 绾€昏緫鎷嗗垎瑙勫垯銆佺姸鎬佹満寤鸿銆丳R 瑙勬ā銆佹娊鍙栧墠蹇呭啓鐨勬祴璇曘€佸浣曡繍琛?`npm run report:complexity` | 鑻辨枃 |
| 鎷嗗垎璁″垝 | [`architecture/refactor-plan.md`](./architecture/refactor-plan.md) | 姣忎釜 `>800` LOC 鏂囦欢鐨勯€?anchor 鎷嗗垎璺嚎鍥撅紙AG-01..AG-35 + TEST-01..TEST-06锛夈€亀ave 瀹氫箟銆乣500-800` LOC 鏂囦欢鏅嬪崌鏍囧噯銆乤nchor 閫€褰规祦绋?| 鑻辨枃 |

---

## 馃摉 鏂囨。缁勭粐

鏈洰褰曢噷鐩墠鍙湁涓€绫绘枃妗ｏ紝浣嗛鐣欏叾浠栦綅缃細

### `audits/` 鈥?浠ｇ爜瀹¤鍘嗗彶
**鐩爣璇昏€咃細** 淇敼 AutoResearch 浠ｇ爜鐨勪汉銆佸仛 code review 鐨勪汉銆佽皟鏌?鍥炲綊闂鐨勪汉銆?
杩欎簺鏂囦欢璁板綍绯荤粺瀹¤涓彂鐜扮殑闂銆佽惤鍦扮殑淇銆佹瘡涓敼鍔ㄧ殑
`file:line`锛屼互鍙婅璁＄悊鐢卞拰鍥炲綊娴嬭瘯娓呭崟銆?
**绾﹀畾锛?*

- 婧愮爜涓殑淇鐢?`// AUDIT-FIX [audit-N-ar#M]` 娉ㄩ噴閿氬畾銆俙N` 鏄?  瀹¤杞锛?銆?銆? 鈥︹€︼級锛宍M` 鏄杞唴鐨勯棶棰樼紪鍙枫€俙-ar` 鍛藉悕
  绌洪棿鍚庣紑鐢ㄦ潵鍜?chat 妯″潡鐨勯敋鐐癸紙`[audit-N#M]`锛夊尯鍒嗗紑銆?- 姣忔潯閿氱偣鐨勫畬鏁存敞閲婂潡璇存槑鍘熷 bug銆佷慨澶嶇淮鎸佺殑涓嶅彉閲忥紝浠ュ強
  蹇呰鐨勫叧鑱斿紩鐢ㄣ€?- 瀹¤鏂囨。鏄?**append-only**锛氭湭鏉ョ殑杞浣滀负鏂扮珷鑺傝拷鍔犲埌搴曢儴锛?  鏃ф潯鐩笉浼氳鏀瑰啓锛屽彧浼氳鏂版潯鐩紩鐢ㄣ€?
**閫熸煡锛?*

```bash
# 鎵€鏈?AutoResearch 閿氬畾杩囩殑淇
rg "AUDIT-FIX \[audit-\d+-ar#" src/

# 鍙湅 AutoResearch 绗笁杞?rg "AUDIT-FIX \[audit-3-ar#" src/

# 椤圭洰涓墍鏈?audit 閿氱偣锛坈hat + AutoResearch锛?rg "AUDIT-FIX \[audit-" src/
```

### 鏈潵锛歚design/`銆乣runbooks/`銆乣migration/`
棰勭暀缁欏悓鏍风殑銆屾寜瀛愮郴缁熷垏鍒嗐€嶇粨鏋勩€?[`design/browser-automation.md`](./design/browser-automation.md) 鏄?`design/` 涓嬬殑绗竴浠芥枃妗ｃ€?
---

## 馃寪 鍙岃绛栫暐

椤跺眰 `README.md` 鏄?**鍙岃锛堣嫳鏂?+ 绠€浣撲腑鏂囷級** 鐨勶紝渚夸簬涓嶅悓璇昏€呫€?鏈洰褰曚笅鐨勬枃妗?**榛樿鍙啓鑻辨枃**锛堢淮鎶よ€呯敤锛夛紝闄ら潪鏂囦欢鍚嶆垨 frontmatter
鍙︽湁璇存槑銆傚鏋滀綘闇€瑕佷腑鏂囩増锛岃鎻?issue锛屼笉瑕佺涓嬬淮鎶ゅ钩琛岀炕璇戙€?
---

## 鉁嶏笍 鏂板鏂囨。

1. 纭畾瀛愮洰褰曪細`audits/`銆乣design/`銆乣runbooks/`銆乣migration/`锛?   鎴栬€呮柊寤轰竴涓被鍒€?2. 鏂囦欢鍚嶏細`kebab-case.md`锛岀敤瀛愮郴缁熷悕缁撳熬
   锛坄auto-research.md`銆乣chat-compression.md`锛夈€?3. 绗竴涓?`# H1` 鍐欏瓙绯荤粺鍚嶃€傜涓€娈典竴鍙ヨ瘽璁叉竻杩欎唤鏂囨。鍐欎粈涔堛€?4. 鍦ㄦ湰绱㈠紩锛堜笂鏂硅〃鏍硷級鍜岄《灞?`README.md`锛堝鏋滃瓙绯荤粺闈㈠悜鐢ㄦ埛锛夐噷
   鍔犱笂閾炬帴銆?5. 濡傛灉鏄璁＄被鏂囨。锛岄伒寰?**`audits/` 涓€鑺?* 鐨勭害瀹氾紙閿氱偣銆?   append-only 缁撴瀯銆佽〃鏍奸噷甯?`file:line`锛夈€?
---

## 馃Л 缁存姢

鏂囨。闅忎唬鐮佺淮鎶ゃ€備慨鏀?`AUDIT-FIX` 閿氱偣闄勮繎鐨勪唬鐮佹椂锛?
1. 閲嶈閿氱偣鐨勫畬鏁存敞閲婏紝纭鏀瑰姩涓嶇牬鍧忎笉鍙橀噺銆?2. 濡傛灉鏀瑰姩鍓婂急鎴栦慨鏀逛簡涓嶅彉閲忥紝鏇存柊閿氱偣 *鍜? 瀹¤鏂囨。涓搴旂殑琛屻€?3. 濡傛灉鏀瑰姩寮曞叆浜?*鏂扮殑* 闇€瑕佽拷韪殑闂锛屽湪涓嬩竴杞珷鑺傚姞
   `[audit-N+1#X]`銆?
澶ч噸鏋勪箣鍚庯紝婧愮爜浣嶇疆浼氱Щ鍔紝鏂囨。閲岀殑 `file:line` 浼氳繃鏈熴€傚畾鏈?閲嶆柊鐢熸垚锛?
```bash
# 澶ч噸鏋勫悗閲嶆柊 grep 鍑?file:line锛屾洿鏂版枃妗ｃ€?# 閿氱偣鏈韩鏄湡鐩镐箣婧?鈥?濡傛灉閲嶆瀯绉诲姩浜嗛敋鐐癸紝鏂囨。閲岀殑琛屽彿
# 浼氬亸锛屼絾 AUDIT-FIX ID 浠嶇劧鎸囧悜姝ｇ‘鐨勪綅缃€?rg "AUDIT-FIX \[audit-\d+-ar#" src/ -n
```
