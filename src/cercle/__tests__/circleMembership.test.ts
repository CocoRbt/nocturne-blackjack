import { describe, expect, it } from 'vitest';
import { isCircleMembershipError, isNicknameTakenError } from '../circleMembership';

describe('erreurs cercle', () => {
  it('détecte une session détachée du cercle', () => {
    expect(isCircleMembershipError("Rejoins un cercle d'abord")).toBe(true);
    expect(isCircleMembershipError('Pas assez dans le coffre.')).toBe(false);
  });

  it('détecte un pseudo déjà pris', () => {
    expect(isNicknameTakenError('Pseudo déjà pris dans ce cercle')).toBe(true);
  });
});
