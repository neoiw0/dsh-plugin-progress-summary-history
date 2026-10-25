# 给 dsh-progress-summary 的提案（发 issue 或 PR 用）

> 目标：把「记录契约」写成公开约定，让其它插件（例如右侧栏历史面板）可以安全消费，
> 而不用读你的源码。**只改文档，不改行为。**

---

## 建议在 README 增加一节「记录契约（供其它插件消费）」

```markdown
## Record contract (for other plugins)

Every accepted summary is committed as one session plugin record:

- **type**: `plugin:progress-summary/line`
- **ignorable**: `true` — readers that do not know this type skip it; it never enters
  the model-visible conversation.
- **data**:

  | field | type | meaning |
  | --- | --- | --- |
  | `line` | `string` | the rendered one-line summary (already cleaned, length-capped by `maxLineChars`) |
  | `state` | `string` | `running` / `idle` at the time of the record |
  | `turn` | `number` | turn index the line belongs to |
  | `at` | `number` | epoch milliseconds |
  | `calls` | `number` | auxiliary calls made so far in that turn |

- The projection `progressSummary` folds only the **latest** record, so the bar above the
  composer shows one line. Consumers that need **history** should fold the records
  themselves (see `createProgressProjection` for the pattern).

### Compatibility promise

- The record type string and the five field names above are treated as a **public
  contract**; changing them is a breaking change and will be called out in CHANGELOG
  with a major version bump.
- New optional fields may be added at any time; consumers must ignore unknown fields.
```

## 为什么建议加

- 已经有第三方插件按这个名字读取记录（右侧栏「进度历史」面板），文档化能让这类消费方
  有据可依，避免靠猜。
- 记录已经是 `ignorable: true`，说明设计上就是可被忽略/可被消费的载体；把契约写出来
  只是把既成事实显式化，成本低。
- 不涉及任何行为改动，纯文档。
