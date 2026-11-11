import catalog from './fg-image-styles.json';

export const fgImageStyles = catalog;
export function fgImageStyle(skillId: string) {
    return fgImageStyles.find(style => style.skillId === skillId);
}

export function composeFGImageStylePrompt(prompt: string, skillIds: string[]) {
    const styles = skillIds.map(fgImageStyle).filter(style => !!style);
    const staged = styles.find(style => !style.direct);
    if (staged) throw new Error(`「${staged.label}」需要参考图片和分层合成。请在 Agent 模式选择此 Skill，按步骤制作。`);
    let task = prompt;
    for (const style of styles) task = task.split(`@${style.slug}`).join('').split(`@[skill:${style.skillId}]`).join('');
    return styles.length ? [task.trim(), 'Image style direction (preserve the user subject and references):', ...styles.map(style => style.prompt)].join('\n\n') : null;
}
