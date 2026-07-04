# better-sqlite3 전환 스파이크

조사일: 2026-07-04

대상: ComfyUI Asset Manager 0.16.3 개발 상태, Windows x64, Electron 39.2.6

## 결론

**현재는 전환하지 않는다.** 기존 DB 호환성과 Electron 재빌드는 확인했지만, 합의한 성능
게이트인 “10만 행 쓰기 경로 p95 정지 시간 50% 이상 감소”를 만족하지 못했다. 현재
sql.js 저장 큐와 원자적 파일 교체를 유지하고, DB 크기나 저장 정지 시간이 실제 사용자
문제로 확인될 때 다시 측정한다.

## 환경과 빌드

- 후보 버전: `better-sqlite3@12.11.1` (`npm view` 기준 최신)
- 측정 런타임: Node.js 24.14.0, Windows x64
- 앱 런타임: Electron 39.2.6
- 최초 npm 설치 바이너리: Node ABI 137로 설치되어 Electron ABI 140에서 로드 실패
- `electron-builder install-app-deps --platform win32 --arch x64`: 성공, 로컬 2.64초
- 재빌드 후 Electron 39 최소 앱에서 `:memory:` DB 열기와 쿼리 성공
- 프로젝트의 `electron-builder.yml`은 이미 `npmRebuild: true`를 사용한다.

네이티브 모듈이므로 패키징 전 Electron 대상 재빌드와 `.node` 파일 unpack 검증은 계속
필요하다. CI의 실제 증가 시간과 Windows 설치 프로그램 smoke test는 이번 스파이크에서
측정하지 않았다.

## 파일 호환성

사용 중인 DB는 원본을 수정하지 않고 읽기 및 임시 복사본으로만 검증했다.

| 항목                         | 결과             |
| ---------------------------- | ---------------- |
| DB 크기                      | 56,475,648 bytes |
| 사용자 테이블                | 12개             |
| sql.js `quick_check`         | `ok`             |
| better-sqlite3 `quick_check` | `ok`             |
| 테이블별 행 수               | 모두 일치        |

SQLite 파일 자체는 호환된다. 다만 better-sqlite3에서 WAL을 활성화한 뒤 구버전으로
되돌릴 때는 `-wal`에만 남은 변경이 있을 수 있으므로 코드 revert만으로는 충분하지 않다.
다운그레이드 전 `wal_checkpoint(TRUNCATE)`와 백업 복구 절차가 필요하다.

## 성능 측정

각 항목은 5회 실행했다. 합성 데이터는 정수 PK와 짧은 텍스트 컬럼을 사용했다.
better-sqlite3 측정에는 transaction과 WAL checkpoint를 포함했다.

| 데이터                      | 구현                                 |  median |     p95 |
| --------------------------- | ------------------------------------ | ------: | ------: |
| 10,000행                    | sql.js insert + export               |  6.30ms | 14.12ms |
| 10,000행                    | better-sqlite3 write + checkpoint    |  8.63ms |  9.17ms |
| 100,000행                   | sql.js insert + export               | 53.30ms | 60.66ms |
| 100,000행                   | better-sqlite3 write + checkpoint    | 82.72ms | 88.41ms |
| 현재 크기 DB, 단일 mutation | sql.js mutation + export             |  6.93ms | 11.07ms |
| 현재 크기 DB, 단일 mutation | better-sqlite3 mutation + checkpoint | 14.01ms | 14.73ms |

10만 행 기준 p95는 better-sqlite3가 45.8% 느렸고, 현재 크기 DB에서도 33.1% 느렸다.
이 결과는 better-sqlite3의 일반적인 동시성·지속 쓰기 장점을 부정하지 않지만, 현재 앱의
단일 프로세스·배치 저장 패턴에서 즉시 전환할 근거는 되지 않는다.

## Repository 마이그레이션 표면

현재 단일 Repository 파일은 약 1,000줄이며 다음 sql.js 호출을 사용한다.

| sql.js 패턴          | 사용 수 | better-sqlite3 대응                         |
| -------------------- | ------: | ------------------------------------------- |
| `getDatabase()`      |      58 | 연결 객체 또는 주입된 adapter               |
| `db.run()`           |      40 | `db.prepare(sql).run(...)` 또는 `db.exec()` |
| `db.prepare()`       |      22 | `db.prepare()`                              |
| `stmt.bind()`        |      20 | `get/all/run` 호출 인자                     |
| `stmt.step()`        |      22 | `get()` 또는 `all()`                        |
| `stmt.getAsObject()` |      21 | `get()`/`all()` 반환 객체                   |
| `stmt.free()`        |      27 | 제거                                        |

쿼리별 반환 타입을 함께 정리해야 하므로 단순 import 교체가 아니다. Repository와 테스트
79개를 동시에 이관하고, `saveDatabase`, debounce, batch mode, 직렬 파일 저장을 제거해야
한다. 예상 변경은 Repository 본문 200~300줄과 DB 초기화·테스트 기반 전체다.

## 재검토 조건

다음 중 하나가 확인되면 스파이크를 다시 수행한다.

- 실제 DB 저장 p95가 50ms 이상으로 증가
- DB 크기가 250MB 이상으로 증가
- 다중 프로세스 또는 동시 읽기 요구가 생김
- sql.js 전체 export가 UI 정지의 원인으로 측정됨

재검토 시에는 GitHub Actions `windows-latest`의 clean install·패키징 시간과 실제 설치
프로그램 시작까지 측정한다.
