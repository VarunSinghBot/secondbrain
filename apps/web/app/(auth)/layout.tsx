export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh w-dvw grid place-items-center m-0 p-0"
         style={{ background: "linear-gradient(to bottom, #fda0a0 0%, #fda0a0 30%, #fff 100%)" }}>
      <div className="h-full w-[90%] flex items-center justify-evenly gap-16">
        <span className="w-full h-full flex flex-col items-center">
          <img src="/authImage.svg" alt="Logo" className="h-[600px] w-auto rounded-md" />
          <h1 className="text-[#e1434b] text-4xl pl-2"><b>Second Brain App</b></h1>
        </span>
        <main className="w-full max-w-[40%] h-[80%] mr-12 flex justify-center items-center">{children}</main>
      </div>
    </div>
  );
}
