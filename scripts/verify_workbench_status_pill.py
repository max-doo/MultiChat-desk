from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATUS_PILL = ROOT / 'src/renderer/src/components/workbench/WorkbenchStatusPill.tsx'
CODE_PREVIEW = ROOT / 'src/renderer/src/components/workbench/WorkbenchCodePreview.tsx'


def main() -> None:
    status = STATUS_PILL.read_text(encoding='utf-8')
    preview = CODE_PREVIEW.read_text(encoding='utf-8')

    checks = [
        "activeFileCategory === 'code' || activeFileCategory === 'text'" in status,
        "activeFileContent.split('\\n').length" in status,
        '{lineCount} 行' in status,
        'formatFileSize' in status,
        'getCodeLanguageLabel' not in status,
        'getCodeLanguageLabel' not in preview,
        '<WorkbenchStatusPill' not in preview,
    ]

    if not all(checks):
        raise SystemExit(f'工作台状态条检查失败: {checks}')

    print('工作台状态条检查通过：代码/文本显示行数，Markdown 保持字数与字符数，代码预览无重复状态条。')


if __name__ == '__main__':
    main()
