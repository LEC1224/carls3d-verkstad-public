import type { DeliveryMethod } from "../lib/delivery";

const PICKUP_MAPS_URL = "https://maps.app.goo.gl/V5MMqLNZgEKiM88Y9";

type Props = {
  value: DeliveryMethod;
  onChange: (value: DeliveryMethod) => void;
  shippingDescription?: string;
};

export default function DeliveryMethodSelector({
  value,
  onChange,
  shippingDescription = "Levereras med PostNord. Frakt tillkommer.",
}: Props) {
  const choices: Array<{
    value: DeliveryMethod;
    title: string;
    description: string;
  }> = [
    {
      value: "shipping",
      title: "Få beställningen skickad",
      description: shippingDescription,
    },
    {
      value: "pickup",
      title: "Hämta hos mig",
      description: "Ingen frakt. Jag kontaktar dig när beställningen är klar.",
    },
  ];

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Hur vill du få din beställning?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`cursor-pointer rounded-xl border p-4 transition ${
              value === choice.value
                ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                : "hover:bg-gray-50"
            }`}
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="deliveryMethod"
                value={choice.value}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{choice.title}</span>
                <span className="mt-1 block text-sm text-gray-600">{choice.description}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
      {value === "pickup" ? (
        <p className="mt-3 text-sm text-gray-600">
          Hämtnings- och avlämningszon:{" "}
          <a
            href={PICKUP_MAPS_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800"
          >
            Carls 3D-verkstad på Google Maps
          </a>
          .
        </p>
      ) : null}
    </fieldset>
  );
}
