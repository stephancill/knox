export type RequestOptions = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  includeHeaders: boolean;
  timeoutMs?: number;
};

export type RequestParseResult = {
  url: string;
  options: RequestOptions;
};

type ParseState = {
  method?: string;
  headers: Record<string, string>;
  body?: string;
  json?: string;
  includeHeaders: boolean;
  timeoutMs?: number;
  url?: string;
};

function parseHeader({ value }: { value: string }): [string, string] {
  const idx = value.indexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid header format: ${value}`);
  }
  const key = value.slice(0, idx).trim();
  const val = value.slice(idx + 1).trim();
  return [key, val];
}

export function parseRequestArgs({ args }: { args: string[] }): RequestParseResult {
  const state: ParseState = {
    headers: {},
    includeHeaders: false,
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    const next = args[i + 1];
    if (!token) {
      continue;
    }

    if ((token === "-X" || token === "--method") && next) {
      state.method = next.toUpperCase();
      i++;
      continue;
    }
    if ((token === "-H" || token === "--header") && next) {
      const [k, v] = parseHeader({ value: next });
      state.headers[k] = v;
      i++;
      continue;
    }
    if ((token === "-d" || token === "--data") && next) {
      state.body = next;
      i++;
      continue;
    }
    if (token === "--json" && next) {
      state.json = next;
      i++;
      continue;
    }
    if ((token === "-m" || token === "--max-time") && next) {
      state.timeoutMs = Math.round(Number(next) * 1000);
      i++;
      continue;
    }
    if (token === "-i") {
      state.includeHeaders = true;
      continue;
    }
    if (!token.startsWith("-")) {
      state.url = token;
    }
  }

  if (!state.url) {
    throw new Error("Missing request URL");
  }

  if (state.json != null) {
    state.body = state.json;
    if (!state.headers["Content-Type"]) {
      state.headers["Content-Type"] = "application/json";
    }
    if (!state.method) {
      state.method = "POST";
    }
  }

  if (state.body && !state.method) {
    state.method = "POST";
  }

  return {
    url: state.url,
    options: {
      method: state.method ?? "GET",
      headers: state.headers,
      body: state.body,
      includeHeaders: state.includeHeaders,
      timeoutMs: state.timeoutMs,
    },
  };
}

export async function executeHttpRequest({
  url,
  options,
}: {
  url: string;
  options: RequestOptions;
}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId =
    options.timeoutMs != null
      ? setTimeout(() => {
          controller.abort();
        }, options.timeoutMs)
      : null;

  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
