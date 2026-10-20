import { LoginForm } from "./LoginForm";
import { signupAllowed } from "@/server/services/orgs";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return <LoginForm canSignup={await signupAllowed()} />;
}
