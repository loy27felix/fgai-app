import { describe, expect, test } from 'bun:test';
import { composeFGImageStylePrompt, fgImageStyles } from '../src/services/fg-image-styles';

describe('FG image styles', () => {
    test('compiles selected style for the actual image model without workflow instructions', () => {
        const style = fgImageStyles.find(item => item.slug === 'minimal-logo-design')!;
        const result = composeFGImageStylePrompt(`@[skill:${style.skillId}] 为一家名叫 FG 的工作室设计标志`, [style.skillId]);
        expect(result).toContain('为一家名叫 FG 的工作室设计标志');
        expect(result).toContain('Minimal flat logo');
        expect(result).not.toContain('@[skill:');
        expect(result).not.toContain('SKILL.md');
    });
    test('requires the staged agent workflow for preserving a photograph in a triptych', () => {
        const style = fgImageStyles.find(item => item.slug === 'starryear-threefold-memory')!;
        expect(() => composeFGImageStylePrompt('保留原照片做记忆拼贴', [style.skillId])).toThrow('分层合成');
    });
    test('does not transform ordinary prompts or unsupported skills', () => {
        expect(composeFGImageStylePrompt('一片森林', [])).toBeNull();
        expect(composeFGImageStylePrompt('一片森林', ['unknown'])).toBeNull();
    });
});
