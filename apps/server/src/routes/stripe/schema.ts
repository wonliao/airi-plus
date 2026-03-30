import { minLength, object, pipe, string } from 'valibot'

export const CheckoutBodySchema = object({
  packageId: pipe(string(), minLength(1)),
})
