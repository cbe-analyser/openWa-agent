import { redirect } from "next/navigation";
import { signupAllowed } from "@/server/services/orgs";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (!(await signupAllowed())) redirect("/login");
  return <SignupForm />;
}
