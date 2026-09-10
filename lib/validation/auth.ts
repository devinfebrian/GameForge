import { z } from "zod";

export const emailSchema = z
  .email({ error: "Enter a valid email address." })
  .trim()
  .toLowerCase();

export const passwordSchema = z
  .string()
  .min(8, { error: "Be at least 8 characters long." })
  .regex(/[a-zA-Z]/, { error: "Contain at least one letter." })
  .regex(/[0-9]/, { error: "Contain at least one number." })
  .regex(/[^a-zA-Z0-9]/, { error: "Contain at least one special character." });

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export interface AuthFormState {
  readonly errors?: {
    readonly email?: ReadonlyArray<string>;
    readonly password?: ReadonlyArray<string>;
  };
  readonly message?: string;
}
