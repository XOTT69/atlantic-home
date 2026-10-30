# Atlantic Home

PWA для керування Atlantic Altis Eco Boost 3 Wi-Fi CHG-BD1/Wi-Fi 1000W через Cozytouch.

## Статус

Поточний коміт — UI foundation. Інтерфейс працює в демонстраційному режимі й **не надсилає команди конвектору**. Підключення до Cozytouch буде активовано лише після перевірки авторизації, моделі та фактичних можливостей пристрою.

## Стек

- Next.js App Router + TypeScript
- PWA manifest, iOS standalone metadata
- Vercel для вебзастосунку
- Захищений серверний адаптер Cozytouch — наступний етап

## Environment

Перед запуском API підключення задай `SESSION_PASSWORD` — випадковий секрет щонайменше 32 символи. На Vercel його потрібно додати в Project Settings → Environment Variables для Production і Preview. Не використовуй значення з `.env.example`.

## Локальний запуск

```bash
npm install
npm run dev
```

## Безпека

- Не зберігати пароль Cozytouch у браузері, localStorage або Git.
- Не комітити токени та .env файли.
- Усі запити до Cozytouch мають виконуватися сервером.
- Не використовувати часте опитування API: враховувати обмеження та backoff.
- Перед керуванням перевірити підтримувані capability конкретного пристрою.

## Поточний стан API

- `POST /api/cozytouch/connect` — авторизація Cozytouch, отримання переліку пристроїв; пароль не зберігається.
- `GET /api/cozytouch/state` — читання setup view із серверної сесії.
- `POST /api/cozytouch/disconnect` — видалення сесії.
- Сесія зберігається в зашифрованій HttpOnly cookie.
- Команди керування навмисно ще не реалізовані: спочатку потрібно визначити capabilities та підтвердити їх значення на конкретному Altis Eco Boost.

## Підключення Cozytouch

Atlantic використовує кілька несумісних платформ під брендом Cozytouch. Для цього проєкту спершу перевіряється API, яким користується офіційний застосунок, а не припускається сумісність із Overkiz. Джерело для дослідження: https://github.com/gduteil/cozytouch
