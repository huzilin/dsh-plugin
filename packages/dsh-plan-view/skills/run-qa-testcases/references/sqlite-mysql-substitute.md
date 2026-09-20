# sqlite 替身测试的 MySQL 语义差异清单（Go/GORM）

> 正本迁移自 OpenViking preferences（2026-09-12 收编）。来源：novel 仓库 16 票实现 + 覆盖率补齐（2026-09-07/08，glebarez/sqlite 内存库替身 MySQL 8）。单测替身与生产库的三类语义落差，踩过一次记一条，写测试前对照。

## 1. 索引名全局唯一（sqlite）vs 表内唯一（MySQL）
MySQL 索引名按表隔离（character.idx_work 与 work.idx_work 共存）；sqlite 同库全局唯一——同库迁移多表必撞 `idx_work` 这类通用名。
处置：每测试独立库/按域迁移分库；或迁移文件里索引用带表前缀名（生产 DDL 命名也建议 `uq_表义_列义` 防移植雷）。

## 2. GORM `default:` tag 吞零值
`gorm:"not null;default:1"` 的布尔/数值列：Go 零值（false/0）插入时 GORM 按零值省列，DB DEFAULT 接管 → 语义静默翻转（实证：arc.is_story_block 0 被写成 1；cognition appended 同型）。
处置：语义布尔列 `not null` 不带 `default` tag，Go 显式赋值；生产 DDL 的 DEFAULT 子句与 ORM tag 是两套东西，分开审。

## 3. AutoMigrate ≠ 生产 DDL
UNIQUE 约束只在 migrations SQL 写了、GORM tag 没标 → 测试库无该约束，唯一键冲突路径测不到（要用双写法或显式断言）。GORM tag 与 DDL 是双源，需一个「契约对照测试」对账（novel 用 TableName↔DDL 静态校验测试）。

## 4. 其他实证差异
- JSON 列：MySQL JSON 类型 GORM 查询/默认值行为与 sqlite TEXT 不同——novel 拍板禁 JSON 列（TEXT+空串默认），替身差异归零
- 字典序比较：locator 这类 `chap10 < chap9` 问题在两种库同样存在，但 MySQL 里藏在 SQL `<=` 比较里更难发现——凡「带数字后缀的标识符做范围比较」一律上移 Go 层自然序比较器（sort.Search 保 O(log n)）
- 并发/行锁：sqlite 单写者，MySQL 行锁（clause.Locking）与唯一键并发冲突路径 sqlite 测不到——并发语义必须真机 E2E（novel 用 192.168.3.100 真库冒烟补位）

## 替身分层口径
单测（sqlite 内存库，TestUnit_*，验证逻辑/状态机/幂等）→ 真机 E2E（迁移、HTTP 链路、并发、真 LLM，见 real-model-e2e.md）。两层不可互替。
