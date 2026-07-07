import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing one of NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

console.log(`Project URL: ${url}`);

const anonClient = createClient(url, anonKey);
const { error: anonError } = await anonClient
  .from("__connection_test__")
  .select("*")
  .limit(1);

if (anonError?.code === "42P01") {
  console.log("anon key: OK (reached the database, table doesn't exist yet — expected)");
} else if (anonError) {
  console.error("anon key: FAILED —", anonError.message);
  process.exit(1);
} else {
  console.log("anon key: OK (unexpected: table __connection_test__ actually exists)");
}

const serviceClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error: serviceError } = await serviceClient.auth.admin.listUsers({ perPage: 1 });

if (serviceError) {
  console.error("service_role key: FAILED —", serviceError.message);
  process.exit(1);
}
console.log("service_role key: OK (admin API reachable)");

console.log("\nSupabase connection test passed.");
