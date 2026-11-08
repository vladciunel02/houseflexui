# HomeFlex în myPPC: Arhitectură pagină client (`PLAN.md`)

## 1. Context produs
- **Scop**: Secțiunea **HomeFlex în myPPC** pentru un singur client prosumator (`Str. Fabricii 12, București`, baterie de `10 kWh`).
- **Cele trei întrebări la care răspunde pagina**:
  1. **Ce face bateria acum și de ce** (blocul `Acum` + modelul arhitectural 3D cu fluxuri pe cabluri).
  2. **Câți bani mi-a adus** (blocul `Bani`: total azi față de bateria fără HomeFlex, defalcat în vânzarea surplusului dimineața și consumul acoperit seara, plus `Ieri` și `Luna aceasta`).
  3. **Care este planul** (`Planul bateriei` pentru `Azi` și `Mâine` după `14:00`, cu rezumatul `Pe scurt` și opțiunea `Compară cu bateria fără HomeFlex`).
- **Singura acțiune a clientului**: `Anulează decizia de azi` (cu confirmare inline care afișează suma estimată pierdută și posibilitate de revenire prin `Reactivează acum`).

## 2. Date și reguli fizice (`src/data/`)
- **[`mockFleet.ts`](src/data/mockFleet.ts)**:
  - `CLIENT_TODAY`: zi însorită cu preț negativ între `11:00–15:00` (`−0,10 lei/kWh`).
  - `CLIENT_TOMORROW`: a doua zi însorită cu preț negativ doar între `12:00–14:00` (`−0,08 lei/kWh`).
  - `MONTH_SAVINGS`: economii deterministe pe zilele trecute ale lunii curente (`0,40`–`3,20 lei`, mai mari în weekendurile însorite).
  - `simulate()`: păstrează exact bilanțul energetic în fiecare interval de 15 minute (`solar + imp + discharge = load + charge + exp`). Exportul în ore cu preț negativ este plătit cu `0 lei` (`trimite fără plată`).
- **[`derive.ts`](src/data/derive.ts)**:
  - `clientSegments(day, strategy)`: unește intervalele de 15 minute în `{start, end, battery, grid, kWh, price, lei}`, contopind segmentele sub `30 min` în vecinul mai lung.
  - `savingsBreakdown(day)`: împarte câștigul față de `Fără HomeFlex` în `din vânzarea surplusului dimineața` și `din consumul acoperit seara`.
  - `cancelledStrategy(day, fromTime)`: rulează `HomeFlex` până la `fromTime`, apoi comportamentul obișnuit `Fără HomeFlex` până la `24:00`.

## 3. Adaptare Desktop (`1440px`) și Mobil (`390px`)
- O singură instanță WebGL `<HouseScene />` este păstrată montată în `.hero-grid`:
  - Pe **Desktop (`> 860px`)**: grilă CSS `58% / 42%` cu modelul 3D în stânga și blocurile `Acum`, `Bani` și `Anulează decizia de azi` în dreapta, urmate de axa `05:00–24:00` (`Preț, lei/kWh`, `Bateria`, `Rețeaua`) și lista `Pe scurt`.
  - Pe **Mobil (`390px`)**: coloană unică fără scroll orizontal: `Acum`, urmat imediat de scena 3D la `320px` înălțime, apoi `Bani`, `Anulează decizia de azi` și `Planul bateriei` redat direct prin rândurile `Pe scurt` (pătrat colorat `12px` + interval orar + preț + propoziție).
- **Controale demo**: bară întunecată separată vizual în colțul dreapta-jos, restrânsă implicit (`Controale demo`), cu slider `00:00–24:00`, `Redă ziua` și `Simulează un nor`.
