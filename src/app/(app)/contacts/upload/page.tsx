import { redirect } from "next/navigation";

/**
 * 엑셀 업로드는 주소록 화면의 대화상자가 되었다. 예전 주소로 들어오면 주소록으로 보낸다.
 * 업로드 화면을 따로 두지 않는 이유: 다 올린 뒤 결과를 확인하러 주소록으로 다시 가야 했고,
 * 어느 그룹·지점에 넣는지 문맥이 화면을 넘어가며 끊겼다.
 */
export default function UploadRedirect() {
  redirect("/contacts");
}
