export function Header({ back }: { back?: { href: string; label: string } }) {
  return (
    <header className="top">
      <a className="brand" href="#/">archivist</a>
      <nav>
        {back && <a href={back.href}>← {back.label}</a>}
        <a href="#/">Biblioteca</a>
        <a href="#/subir">Subir</a>
      </nav>
    </header>
  );
}
