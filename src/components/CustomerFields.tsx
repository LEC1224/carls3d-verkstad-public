import type { DeliveryMethod } from "../lib/delivery";

export type CustomerDetails = {
  name: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
};

export const emptyCustomer = (): CustomerDetails => ({
  name: "", email: "", phone: "", addressLine1: "", addressLine2: "", postalCode: "", city: "", country: "Sverige",
});

type Field = { name: keyof CustomerDetails; label: string; autoComplete: string; type?: string; optional?: boolean; wide?: boolean; maxLength: number };

const contactFields: Field[] = [
  { name: "name", label: "Namn", autoComplete: "name", maxLength: 120 },
  { name: "email", label: "E-post", type: "email", autoComplete: "email", maxLength: 254 },
  { name: "phone", label: "Telefon", type: "tel", autoComplete: "tel", maxLength: 40 },
];
const addressFields: Field[] = [
  { name: "addressLine1", label: "Adress", autoComplete: "address-line1", wide: true, maxLength: 200 },
  { name: "addressLine2", label: "Adressrad 2 (valfritt)", autoComplete: "address-line2", wide: true, optional: true, maxLength: 200 },
  { name: "postalCode", label: "Postnummer", autoComplete: "postal-code", maxLength: 20 },
  { name: "city", label: "Ort", autoComplete: "address-level2", maxLength: 100 },
  { name: "country", label: "Land", autoComplete: "country-name", maxLength: 100 },
];

export default function CustomerFields({ value, onChange, deliveryMethod, idPrefix }: {
  value: CustomerDetails;
  onChange: (value: CustomerDetails) => void;
  deliveryMethod: DeliveryMethod;
  idPrefix: string;
}) {
  const fields = deliveryMethod === "shipping" ? [...contactFields, ...addressFields] : contactFields;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.name} className={field.wide ? "sm:col-span-2" : undefined}>
          <label htmlFor={`${idPrefix}-${field.name}`} className="mb-1 block text-sm font-medium">{field.label}</label>
          <input
            id={`${idPrefix}-${field.name}`}
            name={field.name}
            type={field.type || "text"}
            value={value[field.name]}
            autoComplete={field.autoComplete}
            required={!field.optional}
            maxLength={field.maxLength}
            onChange={(event) => onChange({ ...value, [field.name]: event.target.value })}
            className="w-full rounded-xl border px-3 py-2"
          />
        </div>
      ))}
      {deliveryMethod === "pickup" && <p className="text-sm text-gray-600 sm:col-span-2">Ingen adress behövs vid avhämtning. Jag kontaktar dig när beställningen är klar att hämta.</p>}
    </div>
  );
}
