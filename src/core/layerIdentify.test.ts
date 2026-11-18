import { describe, expect, it } from 'vitest';
import { guessLayer } from './layerIdentify';

describe('层角色识别', () => {
  it('嘉立创/Altium 风格扩展名', () => {
    expect(guessLayer('board.gtl').role).toBe('copper');
    expect(guessLayer('board.gtl').side).toBe('top');
    expect(guessLayer('board.gbl').side).toBe('bottom');
    expect(guessLayer('board.gts').role).toBe('soldermask');
    expect(guessLayer('board.gto').role).toBe('silkscreen');
    expect(guessLayer('board.gtp').role).toBe('solderpaste');
    expect(guessLayer('board.gko').role).toBe('outline');
  });

  it('KiCad 风格命名', () => {
    expect(guessLayer('project-F_Cu.gbr').role).toBe('copper');
    expect(guessLayer('project-F_Mask.gbr').role).toBe('soldermask');
    expect(guessLayer('project-B_Silkscreen.gbr').role).toBe('silkscreen');
    expect(guessLayer('project-Edge_Cuts.gbr').role).toBe('outline');
    expect(guessLayer('project.drl').role).toBe('drill');
  });

  it('内层铜编号', () => {
    const g = guessLayer('board-Inner2.gbr');
    expect(g.role).toBe('copper');
    expect(g.copperIndex).toBe(2);
  });

  it('认不出的 Gerber 兜底为铜层 unknown 权重低', () => {
    const g = guessLayer('mystery.gbr');
    expect(['copper', 'unknown']).toContain(g.role);
  });

  it('钻孔扩展名判定', () => {
    expect(guessLayer('x.xln').isDrill).toBe(true);
    expect(guessLayer('x.nc').isDrill).toBe(true);
  });
});
