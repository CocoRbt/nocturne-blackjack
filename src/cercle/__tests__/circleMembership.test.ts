import { describe, expect, it } from 'vitest';
import { isCircleMembershipError, isMissingProfileFkError, isNicknameTakenError } from '../circleMembership';

describe('erreurs cercle', () => {
  it('détecte une session détachée du cercle', () => {
    expect(isCircleMembershipError("Rejoins un cercle d'abord")).toBe(true);
    expect(isCircleMembershipError('Pas assez dans le coffre.')).toBe(false);
  });

  it('détecte un pseudo déjà pris', () => {
    expect(isNicknameTakenError('Pseudo déjà pris dans ce cercle')).toBe(true);
  });

  it('détecte une FK profiles manquante', () => {
    expect(
      isMissingProfileFkError(
        'insert or update on table "player_scores" violates foreign key constraint "player_scores_profile_id_fkey" — Key (profile_id)=(a30d8791-5fa5-4a7c-89d6-7f459095b0f6) is not present in table "profiles".',
      ),
    ).toBe(true);
  });
});
