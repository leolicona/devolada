# Feature Specification: Account access and identity

**Feature Branch**: `claude/elegant-cannon-62dhzp`

**Created**: 2026-09-09

**Status**: Draft

**Input**: User description: "/docs/legacy/auth/better-auth.spec.md" — the legacy specification of the identity subsystem (registration, email-code proof, sign-in, recovery, sessions, revocation, invitations, passkeys, rate limiting), rebuilt here as a Spec Kit feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account and prove the address (Priority: P1)

A person who wants to start charging through the platform enters their name, email address and a password. Nothing is open to them yet: the address they typed is where their business will be reached and recovered, so the platform emails a six-digit code and asks them to type it on the screen they are already looking at. Once the code is right, they are inside. If they mistyped the address, they simply sign up again with the correct one — the half-finished account is replaced, not defended.

**Why this priority**: no account exists without this journey, and it is the one moment where an unnoticed mistake is permanent — an account reached and recovered through an address nobody reads becomes an unreachable business holding banking details. It is also independently valuable on its own: registration plus proof already puts a working, reachable account inside the product.

**Independent Test**: register with a fresh address, observe that no access is granted, read the code, type it, and land inside the product. Repeat with a mistyped address to confirm the person can correct it unaided.

**Acceptance Scenarios**:

1. **Given** an address nobody has registered, **When** the person completes the registration form, **Then** the account alone is created — no business yet — a code is sent to that address, and the person is shown the code screen with **no** access to the product.
2. **Given** an account whose address is not yet proven, **When** the person tries to sign in with the correct password, **Then** access is refused, a fresh code is sent, and the code screen takes over.
3. **Given** a pending code, **When** the person types it correctly, **Then** the address is marked proven, access begins in that same moment, and the person continues to whatever they were headed for.
4. **Given** a pending code, **When** the person types a wrong or expired one, **Then** they are told so in plain es-MX that calls the six digits *código*, and are offered a resend without leaving the screen.
5. **Given** an account whose address was never proven, **When** someone registers again with that same address, **Then** the earlier attempt is replaced — one account, the new password, a fresh code — rather than answering that the address is taken.
6. **Given** an account whose address **was** proven, **When** someone registers with that same address, **Then** registration is refused because the address belongs to somebody.
7. **Given** the email provider is failing, **When** a person registers, **Then** the account is still created and the screen still offers a resend — the outage is a wait, never a lockout.

---

### User Story 2 - Sign in day to day and land where you were going (Priority: P2)

A returning user opens the product, types their address and password, and is inside. If they arrived by opening a deep link — a specific screen, an invitation — they land on that screen, not on a generic home page.

**Why this priority**: this is the most-repeated journey in the product, and the bounce-and-lose-your-place failure was measured on real users.

**Independent Test**: sign in from the sign-in screen and confirm arrival inside; open a deep screen without access, sign in when prompted, and confirm arrival on that same screen.

**Acceptance Scenarios**:

1. **Given** an account with a proven address, **When** the person signs in with the right password, **Then** access begins and they land inside the product.
2. **Given** a wrong password, or an address nobody registered, **When** the person tries to sign in, **Then** both answers are identical and neither reveals whether the address exists, while the distinct cause of each is recorded for operators.
3. **Given** a person without access opening a deep screen, **When** they are sent to sign in and succeed, **Then** they land on the screen they originally asked for.
4. **Given** a return destination that points outside the product, **When** the person signs in, **Then** the destination is discarded and they land on the default screen.
5. **Given** a person signed in on a phone, a tablet or a desktop, **When** they open their account settings, **Then** they can end their own access from any of them and land on the sign-in screen.

---

### User Story 3 - Recover access when the password is gone (Priority: P2)

A person who cannot remember their password asks for recovery with their address, receives a code, types it together with a new password, and is signed in immediately — without a detour through the sign-in screen. Every session that existed before the reset stops working.

**Why this priority**: without it, a forgotten password is a support ticket per user and, for a sole owner, a permanently unreachable business.

**Independent Test**: request recovery, complete the code and new password on one screen, confirm arrival inside the product, and confirm a session opened before the reset no longer works.

**Acceptance Scenarios**:

1. **Given** any address, registered or not, **When** recovery is requested, **Then** the answer is the same either way and a code is sent only if the account exists.
2. **Given** a valid code, **When** the person submits it with a new password, **Then** the password is replaced, access begins, and they land inside the product.
3. **Given** another device holding access from before, **When** the reset completes, **Then** that device's access is refused on its next action.
4. **Given** a wrong or expired code, **When** it is submitted, **Then** the person is told in plain language and can request another.

---

### User Story 4 - Access ends the moment it should (Priority: P2)

When an account is suspended, when someone's membership in a business is revoked, or when an account is holding access without a proven address, the very next thing that person does is refused — with a screen that explains the situation and names how to get help.

**Why this priority**: this is the platform's ability to actually cut off access. A guarantee that takes effect "eventually" is not one, and the product handles money.

**Independent Test**: suspend an account (or revoke a membership) while that person is working, and confirm their very next action is refused with the right explanation and no lingering access.

**Acceptance Scenarios**:

1. **Given** a person working with live access, **When** their business is suspended, **Then** their next action is refused as suspended, their access is cleared, and they see a suspended-account screen carrying the support channel.
2. **Given** a person with access to a business, **When** their membership is revoked, **Then** their next action no longer reaches that business.
3. **Given** access held by an account whose address was never proven, **When** that access is used, **Then** it is refused for that reason and cleared; the action after that is refused as having no access at all.
4. **Given** access that was refused and cleared, **When** the person retries, **Then** they are sent to sign in without an alarming error.

---

### User Story 5 - Stay signed in for weeks without a visible expiry (Priority: P3)

Someone who uses the product regularly is never asked to sign in again out of nowhere. The access window keeps moving forward as they work, on the device as well as in the platform's own records.

**Why this priority**: a surprise sign-out mid-task is a small betrayal repeated across every user; it is also the failure that hides for a month before appearing all at once.

**Independent Test**: hold access, use the product across several days, and confirm both the platform's record and the device's own stored access have moved their expiry forward.

**Acceptance Scenarios**:

1. **Given** access older than a day that is still in use, **When** the person acts, **Then** the expiry moves forward both in the platform's record **and** on the device.
2. **Given** access less than a day old, **When** the person acts, **Then** nothing is re-issued to the device.
3. **Given** regular use, **When** thirty days pass, **Then** the person has not been asked to sign in again.

---

### User Story 6 - Join a business from an invitation, in one screen (Priority: P3)

Someone invited to an existing business opens the emailed invitation and sees one screen that already knows who they are: the business, the role they are being given, and the address they were invited at — shown as text, never as a field to edit. If they have no account, they set a name and a password and they are in, with the address already proven because the invitation reached that inbox. If they already have an account, the password alone gets them in. Expired or already-used invitations say exactly that.

**Why this priority**: the earlier version asked the invitee a question only the platform could answer ("do you already have an account?"), and people who answered wrong created a business of their own instead of joining the one that invited them.

**Independent Test**: open an invitation with no existing account and confirm the person lands inside the inviting business with the right role, without typing their address and without an extra code step; repeat with an existing account, an expired invitation, and while signed in as somebody else.

**Acceptance Scenarios**:

1. **Given** a pending invitation, **When** the page is opened without any access, **Then** it names the business, the role and the invited address, and shows exactly one form.
2. **Given** an invited address with no account, **When** the person sets a name and password, **Then** the account is created with the address already proven, the invitation is accepted, and they land inside the inviting business as the invited role.
3. **Given** an invited address that already has an account, **When** the person enters their password, **Then** the invitation is accepted and they land inside the inviting business.
4. **Given** access already held by the invited address, **When** the page is opened, **Then** the invitation is accepted on sight.
5. **Given** access held by a **different** address, **When** the page is opened, **Then** the page says so, names the address in use, and offers to switch accounts and come back.
6. **Given** an expired or already-used invitation, **When** the page is opened, **Then** it says which of the two it is and offers a way back to sign in; acceptance is refused.

---

### User Story 7 - Sign in with the device instead of a password (Priority: P3)

After signing in, a person is offered — never forced — to register the device they are on, so that next time one gesture replaces the password. A settings card lists every device they have registered, says when each was added and whether it travels with their keychain, and lets them remove any of them.

**Why this priority**: it removes the password from the most frequent journey and is the strongest available defence against stolen passwords — but the product is fully usable without it, so it follows the password journeys.

**Independent Test**: register a device, sign out, sign in with the device alone, then see it listed in settings and remove it.

**Acceptance Scenarios**:

1. **Given** a person who has just signed in on a device that supports it, **When** the offer to register the device is shown, **Then** it can be declined and the product is fully usable either way.
2. **Given** a registered device, **When** the person signs in with it, **Then** access begins without a password.
3. **Given** a device that cannot do this, **When** the sign-in screen is shown, **Then** the option is not offered at all.
4. **Given** two registered devices, one of which travels with a keychain, **When** the settings card is opened, **Then** both are listed with their name and the date they were added, the travelling one is described as such, and either can be removed.
5. **Given** no registered devices, **When** the settings card is opened, **Then** it says so and still offers to register one.
6. **Given** a device registered against the testing environment, **When** the person signs in on the live product, **Then** that device is not offered.

---

### User Story 8 - The access doors resist automated guessing (Priority: P3)

Sign-in, code requests, code checks, registration and invitation lookups all stop answering after a small number of attempts from the same origin in a short window, and the count survives the platform restarting or moving between machines.

**Why this priority**: every door above accepts a secret short enough to guess at machine speed. It is last only because it protects journeys that must exist first.

**Independent Test**: hammer each door from one origin and confirm it starts refusing at the stated threshold, tells the caller when to retry, and still refuses after the platform restarts.

**Acceptance Scenarios**:

1. **Given** three sign-in attempts from one origin within ten seconds, **When** a fourth arrives, **Then** it is refused with a retry-after indication and the attempt is counted in durable storage.
2. **Given** five code checks from one origin within a minute, **When** a sixth arrives, **Then** it is refused.
3. **Given** five registrations from one origin within a minute, **When** a sixth arrives, **Then** it is refused.
4. **Given** the platform restarting between attempts, **When** the next attempt arrives inside the window, **Then** the earlier attempts still count against it.
5. **Given** a caller whose origin cannot be determined, **When** attempts arrive, **Then** they are not pooled into a single bucket shared with unrelated visitors.
6. **Given** any deployed environment, **When** its configuration is read, **Then** the limits are on; only the automated test suite may turn them off.

---

### Edge Cases

- **The code arrives on a different device than the one signing up.** A person reads their inbox on a personal phone while registering on a shared computer. A code can be carried between devices by a human; anything that acts on being opened would grant access on the wrong device.
- **The email never arrives, or arrives late.** The account exists regardless, the screen offers a resend, and the person is not locked out. An address the provider rejects (unverified sending domain, blocked recipient) must be visible as a failure to operators even though the person's registration succeeded.
- **A mail scanner opens the message before the person does.** Nothing in the message may be consumable by being opened.
- **Two registrations race on the same address.** The result is exactly one account; a proven address always wins over an unproven one.
- **A code is typed wrong repeatedly.** The code dies after a few wrong attempts and the person is offered a fresh one; the door itself throttles independently.
- **Access exists from before a rule was introduced** (an account created before the address had to be proven, or seeded by hand). It is refused and cleared on its next use rather than grandfathered.
- **A person belongs to no business, or to several with none chosen.** Access is valid but the product must say which of the two it is, rather than failing as if they had no access.
- **An invitation is opened by the right person on a device already signed in as somebody else.** This is the only invitation failure the person can fix themselves, so it is named specifically; every other one stays generic.
- **A person resets their password on a device they no longer control.** The reset is exactly the moment older access must stop working.
- **The support channel shown on the suspended screen is unset.** The screen must still be coherent rather than showing an empty contact.
- **A return-to destination points at another site.** It is discarded; an unchecked destination turns the sign-in screen into an open redirect.
- **A return-to destination changes on every render.** The bounce to sign in must happen once, not in a loop — an unsettled destination previously exhausted the browser's memory.

## Requirements *(mandatory)*

### Functional Requirements

**Registration and proof of address**

- **FR-001**: The system MUST let a person register with a name, an email address and a password, and MUST reject a name under 2 characters, a malformed address, or a password under 8 characters, naming each problem under its own field before the request is sent.
- **FR-002**: Registration MUST create the account only; setting up the business itself is a separate journey.
- **FR-003**: The system MUST NOT grant any access at registration. Access MUST begin only when the address is proven.
- **FR-004**: The system MUST prove ownership of an address by sending a six-digit numeric code to it, which the person types into the screen that asked. The system MUST NOT use any proof that acts on being opened or clicked.
- **FR-005**: Typing the correct code MUST mark the address proven and grant access in the same step.
- **FR-006**: Registration MUST succeed even when the message cannot be sent, and the person MUST be able to request the code again from the screen they are on.
- **FR-007**: An account whose address has never been proven MUST NOT reserve that address: registering again with it MUST replace the earlier attempt — one account, the newer password, a fresh code, the earlier code dead.
- **FR-008**: An account whose address has been proven MUST reserve it: a further registration with it MUST be refused as already taken.
- **FR-009**: Signing in with the right password to an unproven address MUST be refused, MUST send a fresh code, and MUST land the person on the code screen.
- **FR-010**: The code screen MUST name the address the code was sent to, MUST offer to send another and confirm when it does, MUST offer starting over with a different address, and MUST offer a way back to sign in.

**Signing in and returning**

- **FR-011**: The system MUST let a person sign in with their address and password.
- **FR-012**: A failed sign-in MUST be indistinguishable whether the address is registered or not.
- **FR-013**: When a person is sent to sign in from a screen they asked for, the system MUST return them to that screen afterwards, and MUST discard any destination that is not a screen of the same application.

**Recovery**

- **FR-014**: The system MUST let a person recover access by proving the address with a code and setting a new password, both on one screen.
- **FR-015**: A recovery request MUST answer identically whether the address is registered or not, and MUST send a message only when it is.
- **FR-016**: Completing a recovery MUST grant access immediately, without a further sign-in.
- **FR-017**: Completing a recovery MUST end every other access the account held.

**Holding and ending access**

- **FR-018**: The system MUST check, on every action that requires access, that the account is still permitted — the address proven, the account not suspended, the membership still standing — reading the current state rather than trusting anything the device presents.
- **FR-019**: A suspension MUST take effect on the account holder's very next action; the system MUST clear their access and MUST distinguish suspension, revoked membership, unproven address, no business and no chosen business from each other.
- **FR-020**: The system MUST show a suspended person a screen carrying the support channel configured by the operator.
- **FR-021**: Access MUST last 30 days and MUST slide forward with use, updating both the platform's record and the device's stored access; a person in regular use MUST NOT be asked to sign in again.
- **FR-022**: The system MUST let a person end their own access from every screen width, not only on a large screen.

**Invitations**

- **FR-023**: The system MUST let an invitation be inspected without any access, using the invitation's own address as the key, returning the business, the role, the invited email address, and whether that address already has an account.
- **FR-024**: The invitation screen MUST present exactly one course of action, decided by the system, and MUST show the invited address as text that cannot be edited.
- **FR-025**: Accepting an invitation with no prior account MUST create the account with the address already proven — the invitation reached that inbox — MUST NOT ask for a code, and MUST grant access as the invited role.
- **FR-026**: The system MUST name the mismatch when the person is signed in as a different address, showing the address in use and offering to switch and return; every other invitation failure MUST stay generic.
- **FR-027**: The system MUST distinguish an expired invitation from one that no longer exists, and MUST refuse acceptance for both.

**Devices**

- **FR-028**: The system MUST offer, after sign-in and never as a requirement, to register the device so it can replace the password on later sign-ins.
- **FR-029**: The system MUST hide the device option entirely where the device cannot support it.
- **FR-030**: The system MUST list every device an account has registered, with its name (or a plain default), the date it was added, and whether it travels with the person's keychain; each MUST be removable, and the list MUST refresh when one is added or removed.
- **FR-031**: The system MUST tell the truth about reach: a registered device is that device, and also the others it syncs to when the person's keychain carries it.
- **FR-032**: Registered devices MUST be tied to the product's own address, and devices registered in a testing environment MUST NOT be offered on the live one.

**Abuse, language and observability**

- **FR-033**: The system MUST limit attempts per origin on sign-in, code requests, code checks, registration, and invitation lookups; MUST count them in durable storage that survives restarts; MUST tell a refused caller when to retry; and MUST determine the origin from the address the platform's edge actually observed.
- **FR-034**: The limits MUST be switchable off only for the automated test suite, and no deployed environment may switch them off.
- **FR-035**: A code MUST die after a small number of wrong attempts and after a short lifetime, independently of the per-origin limit.
- **FR-036**: The system MUST record the distinct cause of every access failure for operators, even when the person is shown one generic message.
- **FR-037**: All copy MUST be plain es-MX, MUST call the six digits *código* — never "token", "OTP" or "enlace" — and MUST NOT name any vendor the platform uses.

### Key Entities

- **Account**: a person's identity on the platform. Holds the name, the one email address, and whether that address has been proven. Exactly one per person; businesses and memberships attach to it.
- **Password**: the secret an account signs in with, never stored in a form that can be read back.
- **Registered device**: a device an account may sign in with instead of a password. Belongs to one account, carries a name, the date it was added, and whether it travels with the person's keychain.
- **Verification code**: a short numeric secret sent to an address to prove the person holds it, used for registration and for recovery. Short-lived, single-purpose, dies on a few wrong attempts, and is replaced whenever a fresh one is requested.
- **Access session**: an account's live access on one device. Carries an expiry that slides forward with use, is ended by suspension, by a password reset, and by the person signing out.
- **Invitation**: a pending offer to join a business at a role, addressed to one email. Carries the business, the role, the invited address, an expiry, and is usable once.
- **Attempt counter**: the record of recent attempts against an access door from one origin, durable across restarts.
- **Business membership** *(owned by the business feature; referenced here)*: what ties an account to a business and a role, and what the platform re-reads on every action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new owner gets from the start of registration to inside the product in under 3 minutes, including fetching the code from their inbox.
- **SC-002**: 100% of accounts that can hold banking details have an address whose ownership was proven.
- **SC-003**: A person who mistypes their address at registration corrects it unaided in under 2 minutes; zero support requests of the "my account has the wrong address" kind.
- **SC-004**: Suspension, membership removal and an unproven address each take effect on the person's very next action — never after a delay measured in minutes.
- **SC-005**: A person using the product at least once a week is never asked to sign in again for at least 30 consecutive days.
- **SC-006**: A daily sign-in with a password takes under 15 seconds; with a registered device, under 5 seconds and no typed secret.
- **SC-007**: A person bounced to sign in from a deep screen returns to that exact screen in 99% of cases, and destinations pointing outside the product succeed 0% of the time.
- **SC-008**: An invitee joins from the emailed invitation in a single screen, without typing their address, without being asked whether they already have an account, and without an extra code step.
- **SC-009**: Automated guessing from one origin is stopped within 4 sign-in attempts per 10 seconds and 6 code checks per minute, and the limits still hold immediately after the platform restarts.
- **SC-010**: Zero access responses reveal whether an address is registered — sign-in failures and recovery requests are indistinguishable between a known and an unknown address.
- **SC-011**: 100% of access failures carry a distinct, attributable cause in the operator's record while the person sees one generic message.
- **SC-012**: After a password reset, 0% of previously held access continues to work.
- **SC-013**: Registration succeeds 100% of the time while the email provider is unavailable, and every such person can complete their proof once it recovers.

## Assumptions

- **Provenance.** This specification rebuilds `docs/legacy/auth/better-auth.spec.md` — including the history absorbed there from `docs/legacy/auth/sessions.spec.md` and `docs/legacy/auth/isp-signup.spec.md` — as a Spec Kit feature. Those files remain normative until this feature is rebuilt in code; the decisions behind each rule (why codes and not links, why the address is proven before access begins, why a reset ends other sessions) live there and are not restated here.
- **Scope: the surviving product only.** The store-network surfaces retired on 2026-08-31 to the `devolada-red` repository — signing in with a phone number, store invitations, the store recovery screens — are **out of scope**, even though the legacy file still carries their scenarios and copy as residue. So is anything the legacy file describes for a tenant called "ISP": the tenant is the *business*.
- **Scope boundaries with neighbouring features.** This feature owns identity: who someone is, how they prove it, and how access begins and ends. It does not own what a business is, who may invite whom, the role matrix, invitation lifetime, or the operator-configured support channel — those belong to the business-and-memberships and operator-panel specifications, which this feature reads.
- **Inherited law, not re-decided here.** Access travels as a cookie the browser's scripts cannot read; the platform's backend is the only party that speaks to identity infrastructure and frontends never hold tokens; account state is read from the database on every request; failures answer a uniform envelope with validation at the edge. These are constitutional and are assumed rather than specified.
- **Registration and business creation are separate.** An account is born with no business; creating one is the next journey.
- **Code lifetime.** Where the legacy file states only that a code dies after a few wrong attempts, this specification assumes a short lifetime on the order of ten minutes, with the resend as the remedy. If a different lifetime is required it is a one-line change to FR-035.
- **Email delivery is best-effort by design.** The provider is reached through the platform's own sending adapter; a failure delays a person's proof but never blocks the creation of their account. Choosing a *messaging* provider for WhatsApp/SMS is a separate, still-open decision (TD-003) and is not part of this feature.
- **Address determination.** The platform runs behind an edge that reports the caller's address; per-origin limits assume that value rather than a header any caller can set.
- **One address per account.** A person has exactly one email address on the platform, held in one place; nothing else stores a second copy of it.
