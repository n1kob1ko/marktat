import { BadRequestException } from '@nestjs/common';
import { loginSchema } from '@marktat/shared';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(loginSchema);

  it('gibt bereinigte Daten zurück und verwirft unbekannte Felder', () => {
    expect(pipe.transform({ email: 'A@B.AT', password: 'x', role: 'ADMIN' })).toEqual({
      email: 'a@b.at',
      password: 'x',
    });
  });

  it('wirft 400 mit Feldfehlern', () => {
    try {
      pipe.transform({ email: 'falsch' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { errors: { path: string }[] };
      expect(body.errors.map((e) => e.path)).toEqual(['email', 'password']);
    }
  });
});
