# Pragmatic Rust Guidelines (Compressed)

Quick-reference of all guidelines. Each section has an ID for cross-referencing.

---

## AI (M-DESIGN-FOR-AI)
- Use idiomatic Rust API patterns per [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html)
- Provide thorough docs for modules and public items; include examples
- Use strong types (avoid primitive obsession, use `C-NEWTYPE`)
- Make APIs testable; ensure good test coverage for hands-off refactoring

## Application (M-APP-ERROR, M-MIMALLOC-APPS)
- Apps may use `anyhow`/`eyre` for error handling (pick one, don't mix); libraries must use canonical error structs (M-ERRORS-CANONICAL-STRUCTS)
- Use `mimalloc` as global allocator for apps (up to 25% perf gain):
```rust,ignore
use mimalloc::MiMalloc;
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;
```

## Documentation (M-CANONICAL-DOCS, M-DOC-INLINE, M-FIRST-DOC-SENTENCE, M-MODULE-DOCS)
- Public items: summary sentence (<15 words) + extended docs + Examples/Errors/Panics/Safety/Abort sections as applicable
- Don't create parameter tables; describe params inline in prose
- Use `#[doc(inline)]` on `pub use` re-exports (except std/3rd-party types)
- First doc sentence must be one line, ~15 words max for skimmability
- All public modules need `//!` module docs covering contents, usage, examples, specs, side effects

## FFI (M-ISOLATE-DLL-STATE)
- Only share 'portable' (`#[repr(C)]`, no statics/TypeId interaction) data between DLLs
- Each Rust DLL has its own statics, type layouts, and TypeIds — sharing non-portable data causes UB
- Affected: allocated types (`String`, `Vec`, `Box`), `tokio`/`log` statics, non-`#[repr(C)]` structs, `TypeId`-dependent data

## Performance (M-HOTPATH, M-THROUGHPUT, M-YIELD-POINTS)
- Identify hot paths early; benchmark with `criterion` or `divan`; enable `debug = 1` in `[profile.bench]`
- Common perf issues: frequent re-allocations, cloned strings, default hasher when collision resistance unneeded (~15-50% gains possible)
- Optimize for items-per-CPU-cycle; batch operations; exploit CPU cache locality
- Don't hot-spin; sleep/yield when no work; avoid single-item processing when batching possible
- Long-running CPU tasks: insert `yield_now().await` every 10-100μs of CPU work to avoid starving other tasks

## Safety (M-UNSAFE-IMPLIES-UB, M-UNSAFE, M-UNSOUND)
- `unsafe` only for UB risk — not for "dangerous" functions like `delete_database()`
- Valid `unsafe` reasons: novel abstractions, performance (after benchmarking), FFI/platform calls
- Never: shorten safe code via transmute, bypass Send bounds, bypass lifetimes
- Novel abstractions: verify no existing alternative, minimal/testable, hardened against adversarial code (panicking closures, misbehaving Deref/Clone/Drop), must pass Miri
- Unsound code (safe-looking code that can cause UB) is **never** acceptable — no exceptions
- Soundness boundaries = module boundaries; safe fns within a module may rely on sibling guarantees

## Universal (M-CONCISE-NAMES, M-DOCUMENTED-MAGIC, M-LINT-OVERRIDE-EXPECT, M-LOG-STRUCTURED, M-PANIC-IS-STOP, M-PANIC-ON-BUG, M-PUBLIC-DEBUG, M-PUBLIC-DISPLAY, M-REGULAR-FN, M-SMALLER-CRATES, M-STATIC-VERIFICATION, M-UPSTREAM-GUIDELINES)
- Avoid weasel words in names (`Service`, `Manager`, `Factory`); use specific names instead
- Document all magic values with why, side effects, and external system interactions; prefer named constants
- Use `#[expect]` over `#[allow]` for lint overrides (warns when lint no longer triggers); include `reason`
- Structured logging: use message templates (no `format!`), name events with dot-notation, follow OTel conventions, redact sensitive data
- Panics = program termination, not exceptions; don't use for error communication; valid for programming errors only
- Detected bugs → panic, not `Error`; unrecoverable invariant violations are programming errors
- All public types: implement `Debug` (custom impl for sensitive data); implement `Display` if meant to be read
- Prefer regular functions over associated functions for non-instance-related logic
- Split crates aggressively for compile time; features unlock extra functionality, crates for standalone use
- Static verification tools: compiler lints, clippy (all major categories + restriction subset), rustfmt, cargo-audit, cargo-hack, cargo-udeps, miri

### Recommended Lints
```toml
[lints.rust]
ambiguous_negative_literals = "warn"
missing_debug_implementations = "warn"
redundant_imports = "warn"
redundant_lifetimes = "warn"
trivial_numeric_casts = "warn"
unsafe_op_in_unsafe_fn = "warn"
unused_lifetimes = "warn"

[lints.clippy]
cargo = { level = "warn", priority = -1 }
complexity = { level = "warn", priority = -1 }
correctness = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
perf = { level = "warn", priority = -1 }
style = { level = "warn", priority = -1 }
suspicious = { level = "warn", priority = -1 }
# Key restriction lints:
allow_attributes_without_reason = "warn"
as_pointer_underscore = "warn"
assertions_on_result_states = "warn"
clone_on_ref_ptr = "warn"
deref_by_slicing = "warn"
disallowed_script_idents = "warn"
empty_drop = "warn"
empty_enum_variants_with_brackets = "warn"
empty_structs_with_brackets = "warn"
fn_to_numeric_cast_any = "warn"
if_then_some_else_none = "warn"
map_err_ignore = "warn"
redundant_type_annotations = "warn"
renamed_function_params = "warn"
semicolon_outside_block = "warn"
string_to_string = "warn"
undocumented_unsafe_blocks = "warn"
unnecessary_safety_comment = "warn"
unnecessary_safety_doc = "warn"
unneeded_field_pattern = "warn"
unused_result_ok = "warn"
# Opt-out:
literal_string_with_formatting_args = "allow"
```

- Follow upstream: [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html), [Style Guide](https://doc.rust-lang.org/nightly/style-guide/), [Design Patterns](https://rust-unofficial.github.io/patterns/intro.html)
- Key upstream checklist: C-CONV (as_/to_/into_), C-GETTER, C-COMMON-TRAITS (Copy/Clone/Eq/Hash/Debug/Default), C-CTOR (Foo::new()), C-FEATURE

## Libraries / Building (M-FEATURES-ADDITIVE, M-OOBE, M-SYS-CRATES)
- All features must be additive; no `no-std` feature (use `std` feature instead); adding a feature must not disable/modify public items
- Libraries must build on all Tier 1 platforms with only `cargo` + `rust`; no extra tools/env vars required by default
- `-sys` crates: govern native build from `build.rs` via `cc` crate, embed sources, pre-generate bindgen glue, support static + dynamic linking

## Libraries / Interop (M-DONT-LEAK-TYPES, M-ESCAPE-HATCHES, M-TYPES-SEND)
- Prefer `std` types in public APIs; don't leak 3rd-party types without good reason (feature-gated leaking OK)
- Native handle wrappers: provide `unsafe from_native()`, `into_native()`, `to_native()` escape hatches
- Public types should be `Send`; all futures must be `Send`; assert with `const _: () = assert_send::<Foo>()`
- `!Send` OK only for instantaneous-use types not held across `.await`; uncontended atomics have negligible cost

## Libraries / Resilience (M-AVOID-STATICS, M-MOCKABLE-SYSCALLS, M-NO-GLOB-REEXPORTS, M-STRONG-TYPES, M-TEST-UTIL)
- Avoid statics in libraries — secret duplication across crate versions causes inconsistency; OK for perf-only caches
- I/O and syscalls must be mockable (file, network, clocks, entropy); use enum-based mock pattern or `test-util` feature
- Mock controllers returned via `fn new_mocked() -> (Self, MockCtrl)`, not accepted as params
- No `pub use foo::*` (except platform HAL re-exports); re-export items individually
- Use strongest `std` type: `PathBuf` not `String` for OS paths; but keep numeric API boundaries as regular numbers
- Test utilities (mocks, sensitive data inspection, safety overrides) behind `test-util` feature flag

## Libraries / UX (M-AVOID-WRAPPERS, M-DI-HIERARCHY, M-ERRORS-CANONICAL-STRUCTS, M-ESSENTIAL-FN-INHERENT, M-IMPL-ASREF, M-IMPL-IO, M-IMPL-RANGEBOUNDS, M-INIT-BUILDER, M-INIT-CASCADED, M-SERVICES-CLONE, M-SIMPLE-ABSTRACTIONS)
- Hide `Arc`/`Rc`/`Box`/`RefCell` from public APIs; expose `&T`/`&mut T`/`T`
- DI hierarchy: concrete types > generics > `dyn Trait`; don't port OO interfaces naively
- Errors: situation-specific structs with `Backtrace` + cause + `is_xxx()` helpers; implement `Debug` + `Display` + `std::error::Error`; don't use global error enums; don't expose inner `ErrorKind` enum directly
- Essential functionality as inherent methods; trait impls forward to inherent fns
- Accept `impl AsRef<str/Path/[u8]>` in functions (not in struct type params)
- Accept `impl Read/Write` for sans-IO design; accept `impl RangeBounds<T>` over `(low, high)` pairs
- Builder pattern for 4+ optional params: `Foo::builder() -> FooBuilder` with chainable setters + `.build()`; required params in builder constructor via deps struct; setter methods named `x()` not `set_x()`; `FooBuilder` has no public `new()`
- Cascade initialization: group 4+ constructor params into semantic helper types
- Service types: implement `Clone` via `Arc<Inner>` pattern for shared ownership
- Limit visible type nesting to 1 level for service types; avoid `Foo<Bar<Baz>>` in primary APIs
