/* ============================================================================
   site.jsx — compose the landing page
   ============================================================================ */
function Site() {
  return (
    <React.Fragment>
      <Nav />
      <Hero />
      <Trust />
      <Values />
      <ManagerSplit />
      <Steps />
      <CTA />
      <Footer />
    </React.Fragment>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<Site />);
