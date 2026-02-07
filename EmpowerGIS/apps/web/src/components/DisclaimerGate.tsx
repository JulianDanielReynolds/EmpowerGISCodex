interface DisclaimerGateProps {
  onAccept: () => void;
}

export default function DisclaimerGate({ onAccept }: DisclaimerGateProps) {
  return (
    <div className="overlay">
      <section className="modal">
        <h1>EmpowerGIS Disclaimer</h1>
        <p>
          This platform presents public records and infrastructure datasets for planning support.
          Data may be incomplete, delayed, or inconsistent across jurisdictions.
        </p>
        <ol>
          <li>Do not treat this platform as the legal source of record.</li>
          <li>Verify boundaries, zoning, and utility conflicts with local authorities.</li>
          <li>Use professional judgment before design, acquisition, or entitlement decisions.</li>
          <li>By continuing, you agree to these usage terms.</li>
        </ol>
        <button className="primary" onClick={onAccept}>
          I Understand, Continue
        </button>
      </section>
    </div>
  );
}
