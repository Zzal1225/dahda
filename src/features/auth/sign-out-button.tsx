"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

export function SignOutButton() {
  return (
    <Button variant="secondary" onClick={() => void signOut()}>
      로그아웃
    </Button>
  );
}
