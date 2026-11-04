import { Suspense } from "react";
import { ContactsTabs } from "@/features/contacts/contacts-tabs";

export default function ContactsLayout({ children }: LayoutProps<"/contacts">) {
  return (
    <>
      <h1 className="text-title-lg">주소록</h1>
      {/* 현재 경로를 읽는 탭은 요청 값이 필요해 경계 안에 둔다. */}
      <Suspense fallback={<div className="h-10 border-b border-border" />}>
        <ContactsTabs />
      </Suspense>
      {children}
    </>
  );
}
