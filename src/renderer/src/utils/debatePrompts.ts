/**
 * 辩论轮转分层提示词构建器。
 *
 * 辩手轮转的 prompt 带变量插值（话题/对手发言/轮次）与阶段分派，
 * 不适合放进 AgentPrompt 磁盘模板系统，故作为代码内常量集中在此。
 *
 * 三阶段：立论(opening) / 交锋(arging) / 结辩(closing)。
 */

/** 辩论阶段 */
export type DebateStage = 'opening' | 'arguing' | 'closing'

/**
 * 将 (round, turn) 映射到辩论阶段。
 * - round === 0          → opening（正反方均立论，反方先立论再首次交锋）
 * - round === lastRound  → closing（正反方均结辩）
 * - 其余中段轮次         → arguing（交锋）
 *
 * 3 轮辩论映射：立论×2 / 交锋×2 / 结辩×2。
 * 1 轮辩论：仅立论；2 轮辩论：立论 + 结辩（无交锋），均为可接受边界。
 */
export function resolveDebateStage(
    round: number,
    _turn: 0 | 1,
    totalRounds: number
): DebateStage {
    const lastRound = Math.max(0, totalRounds - 1)
    if (round === 0) return 'opening'
    if (round === lastRound) return 'closing'
    return 'arguing'
}

const STAGE_LABEL: Record<DebateStage, string> = {
    opening: '立论',
    arguing: '交锋',
    closing: '结辩'
}

export interface BuildPromptArgs {
    topic: string
    /** 0-based 轮次 */
    round: number
    /** 0=正方, 1=反方 */
    turn: 0 | 1
    totalRounds: number
    /** 对手最近一次发言；very first turn 时为空串 */
    opponentSpeech: string
}

/**
 * 按阶段 + 正反方构建辩手轮转提示词。
 * 保留对手发言的 """\n${oppSpeech}\n""" 引用格式，便于下游解析。
 */
export function buildDebatePrompt(args: BuildPromptArgs): string {
    const { topic, round, turn, totalRounds, opponentSpeech } = args
    const stage = resolveDebateStage(round, turn, totalRounds)
    const role = turn === 0 ? '正方' : '反方'
    const stageLabel = STAGE_LABEL[stage]

    const header =
        `你是辩论的${role}。辩论主题：${topic}\n` +
        `本轮为第 ${round + 1} 轮（共 ${totalRounds} 轮），当前阶段：${stageLabel}。\n\n`

    const quoted = opponentSpeech.trim()
        ? `${turn === 0 ? '反方' : '正方'}的发言：\n"""\n${opponentSpeech}\n"""\n\n`
        : ''

    switch (stage) {
        case 'opening':
            if (turn === 0) {
                // 正方立论：无对手发言
                return `${header}请作为正方进行立论开场：明确核心立场，给出 2-3 条支撑论据，并简要界定关键概念。要求逻辑清晰、立场鲜明，300 字以内。`
            }
            // 反方立论：先亮明立场，再针对正方立论最薄弱处首次交锋
            return `${header}${quoted}请作为反方进行立论：先亮明你的核心反方立场与论据，再针对正方立论中最薄弱的一处进行首次交锋。300 字以内。`

        case 'arguing':
            if (turn === 0) {
                return `${header}${quoted}请进入交锋阶段：直接反驳反方最关键的一处论点，随后提出一条新的正向论据巩固本方立场，并可向反方抛出一个追问。300 字以内。`
            }
            return `${header}${quoted}请进入交锋阶段：指出正方论证中的逻辑跳跃或论据不足，给出反方的新论据，并以一个尖锐的反问收尾。300 字以内。`

        case 'closing':
            if (turn === 0) {
                return `${header}${quoted}请进入结辩阶段：总结本方核心立场与最强论据，正面回应反方最具威胁的一处反驳，并以一句有力的结语收束。不要引入全新论点。300 字以内。`
            }
            return `${header}${quoted}请作为反方进行结辩：概括反方立场与最强反驳，正面回应正方本场最有力的一处论证，并以一句有力的结语收束全场。不要引入全新论点。300 字以内。`
    }
}
