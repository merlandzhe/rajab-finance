export const TENANT = "11111111-1111-4111-8111-111111111111";
export const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
export const TEST_USERS = {
  buyer: {
    id: "a6666666-6666-4666-8666-666666666666",
    name: "Новый покупатель",
    role: "client",
  },
  owner: {
    id: "a1111111-1111-4111-8111-111111111111",
    name: "Раджап",
    role: "owner",
  },
  manager: {
    id: "a2222222-2222-4222-8222-222222222222",
    name: "Менеджер",
    role: "manager",
  },
  cashier: {
    id: "a3333333-3333-4333-8333-333333333333",
    name: "Кассир",
    role: "cashier",
  },
  client: {
    id: "a4444444-4444-4444-8444-444444444444",
    name: "Клиент 01",
    role: "client",
  },
  other: {
    id: "b1111111-1111-4111-8111-111111111111",
    name: "Другая организация",
    role: "owner",
  },
  platform: {
    id: "a5555555-5555-4555-8555-555555555555",
    name: "Платформа",
    role: "platform",
  },
} as const;
