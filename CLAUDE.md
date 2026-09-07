# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview（專案概覽）

這是一個 NestJS + Prisma + PostgreSQL 的後端專案，實作角色型存取控制（RBAC）：使用者註冊/登入、JWT access + refresh token 機制，以及以角色限制存取的 API 端點（`auth`、`users`、`products`）。

## Tech Stack（技術棧）

- **框架**：NestJS 11（Express 平台）
- **ORM**：Prisma 7，使用 `prisma-client` generator（非舊版 `prisma-client-js`），輸出至 `generated/prisma`，透過 `@prisma/adapter-pg`（driver adapter）連線，而非 Prisma 內建的連線方式
- **資料庫**：PostgreSQL
- **認證**：`@nestjs/jwt` 負責簽發/驗證 JWT；refresh token 與 access token 黑名單皆為自製邏輯，儲存在 PostgreSQL（沒有使用 Redis 或其他 session store）
- **驗證**：`class-validator` / `class-transformer`，搭配全域 `ValidationPipe`（`src/main.ts`）
- **密碼雜湊**：`bcrypt`
- **套件管理**：pnpm
- **Lint/格式化**：ESLint（`typescript-eslint` 的 `recommendedTypeChecked`）+ Prettier，透過 `eslint-plugin-prettier` 整合
- **測試**：Jest（`ts-jest`）跑單元測試，`test/` 底下另有獨立的 e2e Jest 設定

## Architecture（架構）

- `AppModule` 為根模組，imports `AuthModule`、`UsersModule`、`ProductsModule`，並註冊全域 `ConfigModule`（`envFilePath: ['.env.local', '.env']`）。
- 每個功能模組（`AuthModule`、`UsersModule`、`ProductsModule`）都各自宣告自己的 `PrismaService` provider，並沒有共用來自單一全域 Prisma 模組的實例——目前沒有獨立的 `PrismaModule`。
- `JwtModule` 在 `AuthModule` 中以 `global: true` 註冊，因此 `JwtService` 可在任何地方注入，不需要重複 import `JwtModule`。
- 認證與授權是兩個獨立的 Guard，透過 `@UseGuards(...)` 逐一掛在路由上，並沒有用 `APP_GUARD` 全域註冊：
  - `AuthGuard`（`src/auth/guards/auth.guard.ts`）：解析 Bearer token，查詢 `RevokedAccessToken` 表確認未被撤銷，驗證 JWT 簽章，並把解碼後的 payload 掛到 `request.user`。
  - `RolesGuard`（`src/auth/guards/roles.guards.ts`）：透過 `Reflector` 讀取 `@Roles(...)` 裝飾器設定的必要角色，並比對 `request.user.roles`。沒有加 `@Roles` 的路由不會做角色檢查。
  - 由於是手動掛載，任何要保護的路由都必須明確同時列出兩個 Guard，例如 `@UseGuards(AuthGuard, RolesGuard)`（見 `ProductsController.createProduct`）。
- 目前只有 `ProductsController.createProduct` 使用了 `@Roles(...)`；`UsersController` 目前尚未定義任何路由。

## Directory Structure（目錄結構）

```
src/
  app.module.ts / app.controller.ts / app.service.ts   # 根模組
  auth/
    auth.controller.ts / auth.service.ts / auth.module.ts
    guards/auth.guard.ts        # JWT 驗證 + 撤銷檢查
    guards/roles.guards.ts      # 依 @Roles metadata 做角色檢查
    decorators/roles.decorator.ts
    dto/register.dto.ts, signIn.dto.ts, refresh-token.dto.ts
    enum/role.enum.ts           # Role.Admin / Role.Viewer
  users/
    users.controller.ts（尚未定義路由）/ users.service.ts / users.module.ts
  products/
    products.controller.ts / products.service.ts / products.module.ts
  prisma/
    prisma.service.ts           # 使用 PrismaPg adapter 的 PrismaClient 封裝
prisma/
  schema.prisma
  seed.ts                       # 建立 Role、Permission、RolePermission，以及 admin/viewer 使用者
  migrations/
generated/prisma/                # Prisma client 產出（自動產生，已加入 .gitignore）
test/
  app.e2e-spec.ts, jest-e2e.json
```

## Authentication（認證）

端點定義在 `src/auth/auth.controller.ts`，邏輯在 `src/auth/auth.service.ts`。

- `POST /auth/register` — 檢查該 email 是否已被註冊，用 `bcrypt`（salt rounds 10）雜湊密碼，透過 `UsersService.createUser` 建立使用者，並將該使用者以 `name` 連結到 `VIEWER` 角色。
- `POST /auth/login` — 依 email 查詢使用者（含 `userRoles.role`），用 `bcrypt.compare` 驗證密碼，通過後簽發一組 token pair。
- `POST /auth/refresh` — 依 refresh token 的 SHA-256 雜湊值查詢，找到後刪除該筆紀錄（一次性使用／輪替），並為對應使用者簽發新的 token pair。
- `POST /auth/logout` — 需同時提供 `Authorization: Bearer <access_token>` header 與 body 中的 refresh token。會驗證 access token、確認其 `sub` 與 refresh token 所屬使用者一致，接著在單一 `$transaction` 中：刪除 refresh token、把 access token 的雜湊值 upsert 進 `RevokedAccessToken`，並刪除所有已過期的 `RevokedAccessToken` 紀錄。
- Access token 為簽章 JWT，payload 為 `{ sub, username, roles }`，效期 15 分鐘（`auth.service.ts` 中的 `ACCESS_TOKEN_EXPIRES_IN` 常數；`AuthModule` 的 `JwtModule.registerAsync` 也另外獨立設定了 `expiresIn: '15m'`）。
- Refresh token 為 `crypto.randomBytes(32)` 產生的 hex 字串；資料庫（`RefreshToken` 表）只儲存其 SHA-256 雜湊值（`createHash('sha256')`），效期 7 天（`REFRESH_TOKEN_TTL_MS` 常數）。
- 已撤銷的 access token 以 SHA-256 雜湊值記錄在 `RevokedAccessToken` 表；`AuthGuard` 在每次請求時都會查詢這張表，確認 token 未被撤銷後才進行 JWT 驗簽。
- `.env` 中的 `JWT_EXPIRES_IN` 變數目前程式碼中沒有任何地方讀取——實際的 token 效期一律來自上述寫死的常數。

## Authorization / RBAC（授權 / 角色權限）

- 角色是寫在程式碼中的 TypeScript enum：`Role.Admin = 'ADMIN'`、`Role.Viewer = 'VIEWER'`（`src/auth/enum/role.enum.ts`），並非動態從資料庫讀取。
- `@Roles(...roles: Role[])` 裝飾器（`src/auth/decorators/roles.decorator.ts`）會把所需角色以 route metadata 的形式附加上去（`ROLES_KEY = 'roles'`）。
- `RolesGuard` 會把 `@Roles(...)` 要求的角色與 `request.user.roles`（登入時寫入 JWT 的角色陣列）比對，用 `.some(...)` 判斷——只要符合其中一個角色即可通過。
- 新使用者註冊時一律被指派 `VIEWER` 角色（寫死在 `UsersService.createUser`）；目前沒有任何程式路徑可以在註冊後變更使用者角色。
- JWT payload 中的 `roles` 是登入當下的快照。刷新 token 時（`AuthService.refresh`）會直接沿用該筆 refresh token 紀錄中已經關聯的使用者/角色資料，並不會重新查詢使用者目前最新的角色。
- Prisma schema 中也定義了 `Permission` 與 `RolePermission` 模型，`prisma/seed.ts` 會建立對應資料（例如針對 `products`、`orders`、`users` 的 `create`/`read`/`update`/`delete` 等）。但 `src/` 底下沒有任何程式碼查詢 `Permission` 或 `RolePermission`——目前所有授權判斷都只比對角色名稱，不會比對到權限。

## Database / Prisma（資料庫 / Prisma）

- Schema 檔案：`prisma/schema.prisma`。模型包含：`Users`、`RefreshToken`、`RevokedAccessToken`、`Role`、`UserRole`（關聯表，複合主鍵 `[userId, roleId]`）、`Permission`（`[action, resource]` unique）、`RolePermission`（關聯表，複合主鍵 `[roleId, permissionId]`）、`Product`。
- Generator 為 `prisma-client`（非 `prisma-client-js`），`output = "../generated/prisma"`，`moduleFormat = "cjs"`。應從 `generated/prisma/client` 匯入 client，例如 `import { Prisma, Users } from 'generated/prisma/client'`。
- `schema.prisma` 的 datasource 本身沒有設定 `url`——`PrismaService` 與 `prisma/seed.ts` 都是手動建立 client，並以 `new PrismaPg({ connectionString: process.env.DATABASE_URL })` 作為 `adapter` 參數傳入，屬於 `@prisma/adapter-pg` 的 driver-adapter 模式。
- `PrismaService`（`src/prisma/prisma.service.ts`）繼承 `PrismaClient`，並分別在 `AppModule`、`AuthModule`、`UsersModule`、`ProductsModule` 中各自被宣告為 provider（沒有共用/全域的 Prisma 模組）。
- Migration 檔案位於 `prisma/migrations/`，透過標準 Prisma CLI 操作。
- `prisma/seed.ts`（透過 `pnpm exec prisma db seed` 執行，對應 `package.json` 中 `"prisma": { "seed": "ts-node prisma/seed.ts" }` 的設定）會 upsert：`ADMIN`/`VIEWER` 角色、完整的權限清單、角色與權限的綁定關係（`ADMIN` 擁有全部權限，`VIEWER` 擁有 `read products`、`read_own orders`、`create orders`），以及兩個預設使用者——`admin@example.com` 與 `viewer@example.com`，密碼皆為 `12341234`。

## Coding Conventions（程式碼風格）

- Prettier 設定（`.prettierrc`）：使用單引號，所有地方都加尾隨逗號（`"trailingComma": "all"`）。
- ESLint（`eslint.config.mjs`）繼承 `typescript-eslint` 的 `recommendedTypeChecked` 加上 `eslint-plugin-prettier/recommended`，並覆寫以下規則：`@typescript-eslint/no-explicit-any` 關閉、`@typescript-eslint/no-floating-promises` 設為 `warn`、`@typescript-eslint/no-unsafe-argument` 設為 `warn`、`@typescript-eslint/no-unsafe-assignment` 設為 `error`。
- TypeScript 設定（`tsconfig.json`）：`target: ES2023`、`strictNullChecks: true`，但 `noImplicitAny: false` 且 `strictBindCallApply: false`——並非完整的 `strict` 模式。
- 模組解析方式為 `commonjs`，並開啟 `experimentalDecorators`/`emitDecoratorMetadata`（NestJS 標準設定）。
- 跨模組的 import 多使用 `src/...` 絕對路徑風格（例如 `import { PrismaService } from 'src/prisma/prisma.service'`），只有在同一個功能資料夾內才會用相對路徑。

## API Conventions（API 慣例）

- 所有路由皆使用標準的 NestJS `@Controller()`/`@Post()`/`@Get()` 裝飾器；`main.ts` 中沒有設定全域路由前綴。
- `main.ts` 中註冊了全域 `ValidationPipe`（`app.useGlobalPipes(new ValidationPipe())`）。
- 部分輸入有對應的 `class-validator` DTO（`src/auth/dto/` 下的 `RegisterDto`、`SignInDto`、`RefreshTokenDto`），但目前 `AuthController.register`/`login` 與 `ProductsController.createProduct` 的 `@Body()` 參數型別實際上是 Prisma 產生的型別（`Prisma.UsersCreateInput`、`Prisma.ProductCreateInput`），而不是這些 DTO class。
- `login`/`refresh`/`logout` 成功時明確透過 `@HttpCode(HttpStatus.OK)` 回傳 200（覆寫 Nest 對 `@Post` 預設回傳 201 的行為）。
- 需要認證的路由預期收到標準的 `Authorization: Bearer <access_token>` header。

## Testing（測試）

- 單元測試：Jest 設定寫在 `package.json`（`rootDir: "src"`、`testRegex: ".*\\.spec\\.ts$"`、使用 `ts-jest` 轉譯）。執行指令為 `pnpm test`。
- E2E 測試：獨立設定檔在 `test/jest-e2e.json`。執行指令為 `pnpm run test:e2e`。
- 覆蓋率：`pnpm run test:cov`（輸出路徑相對於 `src` 為 `../coverage`，即專案根目錄下的 `coverage/`）。
- 若要只跑單一測試檔：`pnpm test -- <path-or-pattern>`（標準 Jest CLI 參數傳遞），例如 `pnpm test -- auth.service.spec.ts`。

## Development Commands（開發指令）

```bash
pnpm install                # 安裝依賴

pnpm run start               # 啟動（不含 watch）
pnpm run start:dev           # 啟動並開啟 watch mode
pnpm run start:debug         # 啟動並開啟 --debug --watch
pnpm run start:prod          # 執行編譯後的 dist/main.js

pnpm run build                # nest build

pnpm run lint                 # 對 src/apps/libs/test 執行 eslint --fix
pnpm run format                # 對 src/ 與 test/ 執行 prettier --write

pnpm test                     # 執行單元測試
pnpm run test:watch            # 單元測試，watch mode
pnpm run test:cov              # 單元測試並產生覆蓋率報告
pnpm run test:e2e              # 執行 e2e 測試（test/jest-e2e.json）

pnpm exec prisma migrate dev   # 建立/套用 migration（標準 Prisma CLI，package.json 中未另外包裝成 script）
pnpm exec prisma generate      # 重新產生 Prisma client 至 generated/prisma
pnpm exec prisma db seed       # 執行 prisma/seed.ts（透過 package.json 中的 "prisma.seed" 設定）
```

伺服器會從環境變數讀取 `PORT`（`main.ts`，`process.env.PORT ?? 3000`），`ConfigModule` 會依序載入 `.env.local`、`.env`。

## Important Rules（重要注意事項）

- **`AppModule` 重複註冊了 `ProductsController`/`ProductsService`**：它同時 `imports: [ProductsModule]`，又在自己的 `controllers`/`providers` 陣列中重複列出 `ProductsController`/`ProductsService`。修改 `app.module.ts` 或 `products.module.ts` 時要注意這點，不要假設兩者是乾淨分離的。
- **`register`、`login`、`createProduct` 目前並沒有真的套用 DTO 驗證**：這幾個 handler 的 `@Body()` 參數型別是 Prisma 產生的 input type，因此即使專案中已經有（或可以新增）`RegisterDto`/`SignInDto`/對應的 product DTO，全域 `ValidationPipe` 也不會對這些輸入執行 `class-validator` 檢查。不要因為程式碼裡存在 DTO class，就假設這些輸入已經被驗證。
- **JWT 中的角色宣告是登入當下的快照。** `AuthService.refresh` 並不會重新從資料庫查詢使用者目前的角色，而是直接沿用 refresh token 紀錄中已經儲存的角色資料。不要假設角色變更會在使用者的 refresh token 用盡或重新登入之前立即生效。
- **`Permission`/`RolePermission` 資料表雖然有 seed 資料，但目前沒有任何 Guard 或 Service 使用它們。** 現有的授權檢查（`RolesGuard`）都只比對角色名稱。不要因為 schema 與 seed 資料建了完整的權限模型，就假設程式中已經有權限層級的檢查。
- 新使用者一律被指派 `VIEWER` 角色（寫死在 `UsersService.createUser`）；目前沒有任何端點可以變更使用者角色——除了 seed 之外，角色指派都必須透過直接操作資料庫/Prisma 才能完成。
- 匯入 Prisma client 時請從 `generated/prisma/client`（依 `schema.prisma` 中自訂的 `output` 路徑）匯入，而不是預設的 `@prisma/client` 套件路徑。
- `PrismaService` 是在多個模組中各自獨立提供的，並非來自單一共用的全域模組——不要假設整個應用程式共用同一個 `PrismaClient` 實例。
