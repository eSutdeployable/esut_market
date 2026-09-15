import { trpc } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { OperationalTelemetry } from "./components/OperationalTelemetry";
import "./index.css";
import { createMarketplaceApiFetch } from "./lib/trpcFetch";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
};

const isTelemetryRequestFailure = (error: unknown) => error instanceof Error && error.message.includes("/api/trpc/observability.record");

const apiBaseUrl = import.meta.env.VITE_API_URL;
if (import.meta.env.PROD && !apiBaseUrl) {
  throw new Error("VITE_API_URL is not set. Required for split architecture.");
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
    window.dispatchEvent(new CustomEvent("esut-marketplace-api-error", { detail: { statusCode: error instanceof TRPCClientError ? error.data?.httpStatus : undefined } }));
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
    // A best-effort observability mutation must never generate another observability event.
    if (isTelemetryRequestFailure(error)) return;
    window.dispatchEvent(new CustomEvent("esut-marketplace-api-error", { detail: { statusCode: error instanceof TRPCClientError ? error.data?.httpStatus : undefined } }));
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${apiBaseUrl ?? ""}/api/trpc`,
      transformer: superjson,
      fetch: createMarketplaceApiFetch(),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <OperationalTelemetry />
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
