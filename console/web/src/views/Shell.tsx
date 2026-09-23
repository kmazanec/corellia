import { Link, Outlet } from '@tanstack/react-router';
import { Button } from 'react-aria-components';

import { setToken, useToken } from '../api/token';
import { TokenGate } from './TokenGate';

/** The masthead and page frame every view sits in. */
export function Shell() {
  const token = useToken();
  return (
    <div className="mx-auto max-w-[1680px] px-4 pb-16 pt-8 sm:px-[clamp(20px,4vw,56px)]">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-line pb-3.5">
        <div className="flex flex-wrap items-baseline gap-4">
          <Link to="/" className="font-crest text-[clamp(24px,3.4vw,38px)] font-bold tracking-[0.14em] text-brass-bright [text-shadow:0_1px_0_#000,0_0_26px_rgba(201,147,47,.25)]">
            CORELLIA<span className="font-normal text-paper"> ∴</span>
          </Link>
          <span className="annot tracking-[0.32em]">Operator Console</span>
        </div>
        <nav className="flex items-center gap-6 font-mono text-[10.5px] uppercase tracking-[0.14em]">
          <Link to="/" className="text-line-soft hover:text-brass-bright [&.active]:text-brass" activeOptions={{ exact: true }}>
            Jobs
          </Link>
          {token ? (
            <Button className="text-line-soft outline-none hover:text-oxblood-bright data-[focus-visible]:text-brass" onPress={() => setToken(null)}>
              Forget token
            </Button>
          ) : null}
        </nav>
      </header>
      <div className="ruleline mb-7" />
      <main>{token ? <Outlet /> : <TokenGate />}</main>
    </div>
  );
}
