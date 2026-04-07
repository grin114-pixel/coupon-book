# 쿠폰북

PIN 인증 뒤에만 Supabase 데이터를 불러오는 개인용 쿠폰북 PWA입니다.

## 기능

- 4자리 PIN 인증과 `이 기기 기억하기` 자동 로그인
- FAB 기반 쿠폰 등록/수정 모달
- 금액 자동 콤마 포맷
- 날짜 오름차순 섹션 정렬
- 반복 쿠폰의 월간 자동 회차 계산
- 이미지 업로드와 썸네일 표시
- `사용 완료`, 수정, 삭제 동작
- 오프라인 캐시가 적용된 기본 PWA 구성

## 실행 방법

1. `.env.example`를 복사해서 `.env` 파일을 만듭니다.
2. `.env` 값을 실제 Supabase 프로젝트 값으로 채웁니다.
3. Supabase SQL Editor에서 `supabase-schema.sql`을 실행합니다.
4. `npm install`
5. `npm run dev`

## 환경 변수

```bash
VITE_APP_PIN=1234
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_STORAGE_BUCKET=coupon-images
```

## 참고

- PIN은 프론트엔드 앱 접근 제어용입니다.
- 현재 SQL 정책은 빠른 개인 사용을 위한 공개 정책입니다.
- 반복 쿠폰은 별도 배치 작업 없이, 앱이 열릴 때 현재 월 기준의 다음 회차를 계산해 보여줍니다.
